import { addMinutes } from "date-fns";
import { prisma } from "./db";
import { zonedToUtc, dateKeyInTz, localDayRangeUtc } from "./format";
import {
  BOOKING_HORIZON_DAYS,
  CONFIRM_LEAD_GRACE_MS,
  MIN_BOOKING_LEAD_MINUTES,
  SLOT_STEP_MINUTES,
} from "./constants";
import { fetchExternalBusy } from "./google-calendar";
import { isValidDateKey } from "./date-keys";
import type { Db } from "./prisma-types";

export { isValidDateKey } from "./date-keys";

export interface Interval {
  start: Date;
  end: Date;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function parseHHmm(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

/** Converte "YYYY-MM-DD" (chave de data local) em {year, month, day}. */
export function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

/** Limites (em UTC) do dia local `dateKey` (America/Sao_Paulo). */
export function dayRangeUtc(dateKey: string): Interval {
  const { year, month, day } = parseDateKey(dateKey);
  return localDayRangeUtc(zonedToUtc(year, month, day, 12, 0));
}

/**
 * Regra única de antecedência e horizonte, usada tanto para LISTAR quanto para
 * CONFIRMAR horários: não antes de agora + antecedência mínima, não depois de
 * agora + horizonte. `graceMs` abate parte da antecedência (só na confirmação).
 */
export function isBookableStart(start: Date, now: Date = new Date(), graceMs = 0): boolean {
  const t = start.getTime();
  if (Number.isNaN(t)) return false;
  const earliest = now.getTime() + MIN_BOOKING_LEAD_MINUTES * 60_000 - graceMs;
  const latest = now.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60_000;
  return t >= earliest && t <= latest;
}

/**
 * Janelas de atendimento (em UTC) de um dia, já excluindo o intervalo de
 * almoço. Retorna [] se o dia estiver fora do expediente.
 */
async function getDayWindows(dateKey: string, db: Db): Promise<Interval[]> {
  const { year, month, day } = parseDateKey(dateKey);
  // Dia da semana a partir dos componentes de data locais (independe do fuso do servidor).
  const weekday = new Date(year, month - 1, day).getDay();

  const hours = await db.businessHours.findUnique({ where: { dayOfWeek: weekday } });
  if (!hours || !hours.active) return [];

  const start = parseHHmm(hours.startTime);
  const end = parseHHmm(hours.endTime);
  const windowStart = zonedToUtc(year, month, day, start.hour, start.minute);
  const windowEnd = zonedToUtc(year, month, day, end.hour, end.minute);

  if (!hours.breakStart || !hours.breakEnd) {
    return [{ start: windowStart, end: windowEnd }];
  }

  const breakStart = parseHHmm(hours.breakStart);
  const breakEnd = parseHHmm(hours.breakEnd);
  const breakStartUtc = zonedToUtc(year, month, day, breakStart.hour, breakStart.minute);
  const breakEndUtc = zonedToUtc(year, month, day, breakEnd.hour, breakEnd.minute);

  const windows: Interval[] = [];
  if (windowStart < breakStartUtc) windows.push({ start: windowStart, end: breakStartUtc });
  if (breakEndUtc < windowEnd) windows.push({ start: breakEndUtc, end: windowEnd });
  return windows;
}

/**
 * Janelas em que um serviço de `durationMinutes` pode ser atendido.
 *
 * Regra geral: o almoço divide o dia e o serviço precisa caber inteiro antes OU depois dele.
 * Exceção para serviços LONGOS: se o serviço é mais longo que o menor turno do dia (ex.: almoço 12h–13h num expediente
 * 09h–18h deixa turnos de 3 h e 5 h; um serviço de 4 h ou 5 h não cabe nos dois), o almoço deixa de bloquear e ele pode
 * atravessá-lo. A janela passa a ser o expediente inteiro (abertura até fechamento) e cada início de 15 em 15 minutos
 * que cabe e não conflita com reservas, bloqueios ou a agenda externa é oferecido, como acontece com os serviços curtos.
 * Serviço que cabe em todos os turnos (ou dia sem almoço, ou com um turno só) segue a regra geral, sem mudança.
 *
 * Listar e confirmar usam esta MESMA função (veja generateSlotCandidatesForDate e isSlotAvailable).
 */
async function getServiceWindows(dateKey: string, durationMinutes: number, db: Db): Promise<Interval[]> {
  const turns = await getDayWindows(dateKey, db);
  if (turns.length < 2) return turns;
  const shortestTurnMinutes = Math.min(...turns.map((w) => (w.end.getTime() - w.start.getTime()) / 60_000));
  if (durationMinutes <= shortestTurnMinutes) return turns;
  return [{ start: turns[0].start, end: turns[turns.length - 1].end }];
}

/**
 * Intervalos ocupados no dia: bloqueios pontuais + agendamentos ativos + os
 * intervalos da agenda externa (`externalBusy`), já consultada ANTES da
 * transação pelo chamador (nunca fazemos chamada de rede aqui dentro).
 */
async function getBusyIntervals(
  dateKey: string,
  db: Db,
  excludeAppointmentId?: string,
  externalBusy: Interval[] = []
): Promise<Interval[]> {
  const { start: dayStart, end: dayEnd } = dayRangeUtc(dateKey);
  return busyBetween(dayStart, dayEnd, db, excludeAppointmentId, externalBusy);
}

async function busyBetween(
  rangeStart: Date,
  rangeEnd: Date,
  db: Db,
  excludeAppointmentId: string | undefined,
  externalBusy: Interval[]
): Promise<Interval[]> {
  const blocks = await db.blockedPeriod.findMany({
    where: { startAt: { lt: rangeEnd }, endAt: { gt: rangeStart } },
  });

  const appointments = await db.appointment.findMany({
    where: {
      id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
      status: { in: ["CONFIRMADA", "CONCLUIDA"] },
      startAt: { lt: rangeEnd },
      endAt: { gt: rangeStart },
    },
  });

  return [
    ...blocks.map((b) => ({ start: b.startAt, end: b.endAt })),
    ...appointments.map((a) => ({ start: a.startAt, end: a.endAt })),
    ...externalBusy,
  ];
}

/**
 * Há alguma reserva ativa, bloqueio ou compromisso externo sobrepondo o
 * intervalo? Usado ao REATIVAR uma reserva (não reaplica expediente/grade, que
 * já valiam quando ela foi criada). `excludeAppointmentId` ignora a própria reserva.
 */
export async function hasBusyConflict(
  startAt: Date,
  endAt: Date,
  db: Db,
  excludeAppointmentId?: string,
  externalBusy: Interval[] = []
): Promise<boolean> {
  const busy = await busyBetween(startAt, endAt, db, excludeAppointmentId, externalBusy);
  return busy.some((b) => overlaps(startAt, endAt, b.start, b.end));
}

export interface SlotCandidate {
  start: Date;
  available: boolean;
}

/**
 * Gera os horários de início disponíveis (em UTC) para um serviço em um
 * determinado dia local, considerando expediente, almoço, bloqueios,
 * agendamentos existentes e a agenda do Google (se conectada).
 * Lança CalendarUnavailableError se a agenda conectada não puder ser consultada.
 */
export async function generateSlotsForDate(
  dateKey: string,
  durationMinutes: number,
  db: Db = prisma,
  opts: SlotListOptions = {}
): Promise<Date[]> {
  const candidates = await generateSlotCandidatesForDate(dateKey, durationMinutes, db, opts);
  return candidates.filter((c) => c.available).map((c) => c.start);
}

/**
 * Todos os horários de início possíveis dentro do expediente de um dia, cada
 * um marcado como disponível ou não (passado, antecedência mínima, horizonte,
 * bloqueio ou agendamento existente). Base de `generateSlotsForDate`.
 * Grade: cada janela começa no início do expediente e avança de 15 em 15 min.
 */
export interface SlotListOptions {
  /** Aceita a resposta em cache (15 s) da agenda externa. SÓ para listar; confirmar nunca usa. */
  cacheExternal?: boolean;
  /** Reagendamento: ignora esta reserva (a própria cliente) ao calcular o que está ocupado. */
  excludeAppointmentId?: string;
}

export async function generateSlotCandidatesForDate(
  dateKey: string,
  durationMinutes: number,
  db: Db = prisma,
  opts: SlotListOptions = {}
): Promise<SlotCandidate[]> {
  if (!isValidDateKey(dateKey)) return [];

  const windows = await getServiceWindows(dateKey, durationMinutes, db);
  if (windows.length === 0) return [];

  const day = dayRangeUtc(dateKey);
  // Fora do período reservável não há o que listar, e a consulta ao Google (cota da API) seria desperdiçada:
  // sem esta guarda, datas arbitrárias enviadas ao servidor gastariam a cota que a confirmação precisa.
  const nowMs = Date.now();
  if (day.end.getTime() < nowMs || day.start.getTime() > nowMs + (BOOKING_HORIZON_DAYS + 1) * 86_400_000) return [];
  // A agenda local (banco) e a externa (Google, rede) são independentes: consultadas ao mesmo tempo.
  const [external, local] = await Promise.all([
    fetchExternalBusy(day.start, day.end, db, { allowCache: opts.cacheExternal }),
    busyBetween(day.start, day.end, db, opts.excludeAppointmentId, []),
  ]);
  const busy = [...local, ...external];
  const now = new Date();

  const slots: SlotCandidate[] = [];

  for (const window of windows) {
    let candidate = window.start;
    while (addMinutes(candidate, durationMinutes) <= window.end) {
      const candidateEnd = addMinutes(candidate, durationMinutes);

      const bookable = isBookableStart(candidate, now);
      const hasConflict = busy.some((b) => overlaps(candidate, candidateEnd, b.start, b.end));

      slots.push({ start: candidate, available: bookable && !hasConflict });

      candidate = addMinutes(candidate, SLOT_STEP_MINUTES);
    }
  }

  return slots;
}

/**
 * Reverifica, de forma independente, se um horário específico ainda está
 * disponível, aplicando EXATAMENTE as mesmas regras da listagem: dentro do
 * expediente (fora do almoço), alinhado à grade de 15 min, respeitando
 * antecedência mínima e horizonte, e sem conflito. Usado dentro da transação
 * de criação (veja lib/booking.ts). `externalBusy` vem da agenda externa,
 * consultada antes da transação.
 */
export async function isSlotAvailable(
  startAt: Date,
  durationMinutes: number,
  db: Db,
  excludeAppointmentId?: string,
  externalBusy: Interval[] = [],
  now: Date = new Date()
): Promise<boolean> {
  if (Number.isNaN(startAt.getTime())) return false;

  const dateKey = dateKeyInTz(startAt);
  const windows = await getServiceWindows(dateKey, durationMinutes, db);
  const endAt = addMinutes(startAt, durationMinutes);

  const window = windows.find((w) => startAt >= w.start && endAt <= w.end);
  if (!window) return false;

  if ((startAt.getTime() - window.start.getTime()) % (SLOT_STEP_MINUTES * 60_000) !== 0) return false;
  if (!isBookableStart(startAt, now, CONFIRM_LEAD_GRACE_MS)) return false;

  const busy = await getBusyIntervals(dateKey, db, excludeAppointmentId, externalBusy);
  return !busy.some((b) => overlaps(startAt, endAt, b.start, b.end));
}
