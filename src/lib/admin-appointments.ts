import { prisma } from "./db";
import { zonedToUtc } from "./format";
import { dateKeyOr } from "./date-keys";
import { normalizePlate } from "./plate";
import type { Db } from "./prisma-types";
import type { AppointmentStatus } from "./types";

/**
 * Listagem de agendamentos do painel (/admin/agendamentos).
 *
 * Limites escolhidos para o fluxo da administradora (o código não tinha nenhum):
 *  - intervalo padrão: o dia de hoje (comportamento anterior), quando `from`/`to` faltam ou são inválidos;
 *  - intervalo máximo: 92 dias (cerca de 3 meses) mesmo para datas digitadas na URL; acima disso o fim é recuado;
 *  - página: 25 agendamentos, fixo (um dia comum tem bem menos; 25 cabe numa tela sem rolagem exagerada).
 */
export const ADMIN_LIST_MAX_RANGE_DAYS = 92;
export const ADMIN_LIST_PAGE_SIZE = 25;

/** Soma `days` dias a uma chave "YYYY-MM-DD" (aritmética de calendário, sem depender do fuso do servidor). */
export function addDaysToDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Quantos dias o intervalo [fromKey, toKey] cobre, contando os dois extremos. */
function inclusiveDays(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

export interface ResolvedRange {
  fromKey: string;
  toKey: string;
  /** O fim informado passava do máximo e foi recuado. */
  clamped: boolean;
}

/**
 * Datas vindas da URL -> intervalo seguro. Valida o calendário real (datas impossíveis caem no padrão), garante
 * from <= to e aplica o intervalo máximo. `todayKey` é "hoje" no fuso America/Sao_Paulo.
 */
export function resolveDateRange(rawFrom: string | undefined, rawTo: string | undefined, todayKey: string): ResolvedRange {
  const fromKey = dateKeyOr(rawFrom, todayKey);
  let toKey = dateKeyOr(rawTo, fromKey);
  if (toKey < fromKey) toKey = fromKey;
  const maxToKey = addDaysToDateKey(fromKey, ADMIN_LIST_MAX_RANGE_DAYS - 1);
  const clamped = inclusiveDays(fromKey, toKey) > ADMIN_LIST_MAX_RANGE_DAYS;
  return { fromKey, toKey: clamped ? maxToKey : toKey, clamped };
}

/** Teto do texto de busca (cliente ou placa): barra consultas gigantes vindas da URL. */
export const ADMIN_SEARCH_MAX_LENGTH = 60;

/** Busca digitada na URL -> texto limpo (sem controles, sem espaços nas pontas, no máximo 60 caracteres) ou "". */
export function cleanSearchQuery(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, ADMIN_SEARCH_MAX_LENGTH);
}

/**
 * Filtro de busca por NOME DA CLIENTE ou PLACA. A placa é comparada na forma normalizada (maiúsculas, sem hífen), então
 * "abc-1d" acha "ABC1D23". Parâmetros sempre passam pelo Prisma (nada de SQL montado à mão).
 */
export function buildSearchFilter(query: string | undefined) {
  const q = cleanSearchQuery(query);
  if (!q) return {};
  const plate = normalizePlate(q);
  const or: object[] = [{ client: { name: { contains: q, mode: "insensitive" as const } } }];
  // Fragmento de placa só com letras/números e pelo menos 2 caracteres (evita casar tudo com "-" ou "1").
  if (/^[A-Z0-9]{2,8}$/.test(plate)) or.push({ vehiclePlateSnapshot: { contains: plate } });
  return { OR: or };
}

/** Número da página vindo da URL: inteiro >= 1; qualquer outra coisa vira 1. */
export function parsePageNumber(raw: string | undefined): number {
  if (!raw || !/^\d{1,6}$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}

/**
 * Uma página dos agendamentos do intervalo [fromKey, toKey] (dias locais, fim inclusivo), por horário e, no
 * empate, por id — sem o desempate, linhas com o mesmo horário poderiam repetir ou sumir entre páginas.
 * Página além da última devolve a última.
 */
export async function listAppointmentsPage(
  params: { fromKey: string; toKey: string; status?: AppointmentStatus; page: number; query?: string },
  db: Db = prisma
) {
  const [fy, fm, fd] = params.fromKey.split("-").map(Number);
  const fromUtc = zonedToUtc(fy, fm, fd, 0, 0);
  // Fim EXCLUSIVO = meia-noite local do dia seguinte ao último dia (não "+24h": segue o calendário, não o relógio).
  const [ty, tm, td] = addDaysToDateKey(params.toKey, 1).split("-").map(Number);
  const toUtc = zonedToUtc(ty, tm, td, 0, 0);

  const search = buildSearchFilter(params.query);
  const where = { startAt: { gte: fromUtc, lt: toUtc }, status: params.status ? params.status : undefined, ...search };
  const total = await db.appointment.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_LIST_PAGE_SIZE));
  const page = Math.min(Math.max(1, params.page), pageCount);

  const items = await db.appointment.findMany({
    where,
    include: { client: { select: { name: true, phone: true } } },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
    skip: (page - 1) * ADMIN_LIST_PAGE_SIZE,
    take: ADMIN_LIST_PAGE_SIZE,
  });
  return { items, total, page, pageCount };
}
