import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "./db";
import { zonedToUtc } from "./format";
import { TIMEZONE } from "./constants";
import { ALL_APPOINTMENT_STATUSES, type AppointmentStatus } from "./types";
import { dateKeyOr } from "./date-keys";
import { dateKeyInTz } from "./format";

export type PeriodKind = "DIARIO" | "SEMANAL" | "MENSAL";

function keyParts(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function toKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Deslocamento (em dias) até a segunda-feira da semana que contém a data. */
function mondayOffset(weekday: number): number {
  return (weekday + 6) % 7;
}

interface PeriodRange {
  startKey: string;
  endKeyExclusive: string;
  start: Date;
  end: Date;
  label: string;
}

function toUtcBoundary(key: string): Date {
  const { y, m, d } = keyParts(key);
  return zonedToUtc(y, m, d, 0, 0);
}

export function getPeriodRange(kind: PeriodKind, refKeyInput: string): PeriodRange {
  // Defesa em profundidade: nunca converte uma chave inválida em Invalid Date.
  const refKey = dateKeyOr(refKeyInput, dateKeyInTz(new Date()));
  const { y, m, d } = keyParts(refKey);
  const ref = new Date(y, m - 1, d);

  let start: Date;
  let endExclusive: Date;
  let label: string;

  if (kind === "DIARIO") {
    start = ref;
    endExclusive = new Date(y, m - 1, d + 1);
    label = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(ref);
  } else if (kind === "SEMANAL") {
    const offset = mondayOffset(ref.getDay());
    start = new Date(y, m - 1, d - offset);
    endExclusive = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    const lastDay = new Date(endExclusive.getFullYear(), endExclusive.getMonth(), endExclusive.getDate() - 1);
    const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
    label = `${fmt.format(start)} a ${fmt.format(lastDay)}`;
  } else {
    start = new Date(y, m - 1, 1);
    endExclusive = new Date(y, m, 1);
    label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(start);
    label = label.charAt(0).toUpperCase() + label.slice(1);
  }

  const startKey = toKey(start);
  const endKeyExclusive = toKey(endExclusive);

  return {
    startKey,
    endKeyExclusive,
    start: toUtcBoundary(startKey),
    end: toUtcBoundary(endKeyExclusive),
    label,
  };
}

export function shiftPeriodKey(kind: PeriodKind, refKey: string, delta: number): string {
  const { y, m, d } = keyParts(refKey);
  const ref = new Date(y, m - 1, d);
  if (kind === "DIARIO") ref.setDate(ref.getDate() + delta);
  else if (kind === "SEMANAL") ref.setDate(ref.getDate() + 7 * delta);
  else ref.setMonth(ref.getMonth() + delta);
  return toKey(ref);
}

export interface BillingSummary {
  rangeLabel: string;
  concludedCents: number;
  concludedCount: number;
  predictedCents: number;
  predictedCount: number;
  countsByStatus: Record<AppointmentStatus, number>;
  revenueByService: { name: string; cents: number }[];
  chart: { label: string; cents: number }[];
}

export async function getBillingSummary(kind: PeriodKind, refKey: string): Promise<BillingSummary> {
  const range = getPeriodRange(kind, refKey);
  const inRange = { startAt: { gte: range.start, lt: range.end } };

  // Agregação no banco (antes: todas as reservas do período eram trazidas e somadas em JavaScript).
  // Três consultas independentes, em paralelo; só as concluídas voltam linha a linha, e apenas
  // quando o gráfico por dia/semana precisa do horário local de cada uma.
  const [byStatus, byService, concludedRows] = await Promise.all([
    prisma.appointment.groupBy({ by: ["status"], where: inRange, _count: { _all: true }, _sum: { priceCents: true } }),
    prisma.appointment.groupBy({ by: ["serviceName"], where: { ...inRange, status: "CONCLUIDA" }, _sum: { priceCents: true } }),
    kind === "DIARIO"
      ? Promise.resolve([] as { startAt: Date; priceCents: number }[])
      : prisma.appointment.findMany({ where: { ...inRange, status: "CONCLUIDA" }, select: { startAt: true, priceCents: true } }),
  ]);

  const countsByStatus = Object.fromEntries(ALL_APPOINTMENT_STATUSES.map((s) => [s, 0])) as Record<AppointmentStatus, number>;
  let concludedCents = 0;
  let concludedCount = 0;
  let predictedCents = 0;
  let predictedCount = 0;

  for (const row of byStatus) {
    const status = row.status as AppointmentStatus;
    countsByStatus[status] = (countsByStatus[status] ?? 0) + row._count._all;
    if (status === "CONCLUIDA") {
      concludedCents += row._sum.priceCents ?? 0;
      concludedCount += row._count._all;
    } else if (status === "CONFIRMADA") {
      predictedCents += row._sum.priceCents ?? 0;
      predictedCount += row._count._all;
    }
  }

  const revenueByService = byService
    .map((r) => ({ name: r.serviceName, cents: r._sum.priceCents ?? 0 }))
    .sort((a, b) => b.cents - a.cents);

  const chartBuckets = new Map<string, number>();
  for (const a of concludedRows) {
    const bucket = chartBucketLabel(kind, a.startAt);
    chartBuckets.set(bucket.key, (chartBuckets.get(bucket.key) ?? 0) + a.priceCents);
  }

  return {
    rangeLabel: range.label,
    concludedCents,
    concludedCount,
    predictedCents,
    predictedCount,
    countsByStatus,
    revenueByService,
    chart: buildChartSeries(kind, range, chartBuckets),
  };
}

function chartBucketLabel(kind: PeriodKind, startAt: Date): { key: string; label: string } {
  // Usamos os componentes locais (America/Sao_Paulo) já embutidos no horário
  // de exibição; para granularidade de calendário (dia/semana), basta operar
  // nos componentes de data, como no resto do app.
  const local = toLocalDateOnly(startAt);

  if (kind === "SEMANAL") {
    const weekdayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    return { key: toKey(local), label: weekdayLabels[local.getDay()] };
  }

  if (kind === "MENSAL") {
    const offset = mondayOffset(local.getDay());
    const weekStart = new Date(local.getFullYear(), local.getMonth(), local.getDate() - offset);
    const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
    return { key: toKey(weekStart), label: fmt.format(weekStart) };
  }

  // DIARIO: não usado para bucket por data — ver buildChartSeries.
  return { key: toKey(local), label: toKey(local) };
}

function toLocalDateOnly(date: Date): Date {
  const key = formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd");
  const { y, m, d } = keyParts(key);
  return new Date(y, m - 1, d);
}

function buildChartSeries(
  kind: PeriodKind,
  range: PeriodRange,
  buckets: Map<string, number>
): { label: string; cents: number }[] {
  if (kind === "DIARIO") {
    // Para o dia, o gráfico mais útil é o faturamento por serviço (calculado
    // separadamente); aqui devolvemos vazio e a página usa revenueByService.
    return [];
  }

  if (kind === "SEMANAL") {
    const { y, m, d } = keyParts(range.startKey);
    const weekdayLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const series: { label: string; cents: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(y, m - 1, d + i);
      series.push({ label: weekdayLabels[i], cents: buckets.get(toKey(day)) ?? 0 });
    }
    return series;
  }

  // MENSAL: uma barra por semana (segunda-feira de início) que intersecta o mês.
  const series: { label: string; cents: number }[] = [];
  const seen = new Set<string>();
  const { y, m, d } = keyParts(range.startKey);
  const monthStart = new Date(y, m - 1, d);
  const { y: ey, m: em, d: ed } = keyParts(range.endKeyExclusive);
  const monthEndExclusive = new Date(ey, em - 1, ed);

  let cursor = new Date(monthStart);
  while (cursor < monthEndExclusive) {
    const offset = mondayOffset(cursor.getDay());
    const weekStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - offset);
    const key = toKey(weekStart);
    if (!seen.has(key)) {
      seen.add(key);
      const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
      series.push({ label: fmt.format(weekStart), cents: buckets.get(key) ?? 0 });
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  return series;
}
