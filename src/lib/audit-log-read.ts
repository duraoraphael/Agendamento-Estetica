import { prisma } from "./db";
import { requireAdmin } from "./session";
import { addDaysToDateKey, parsePageNumber } from "./admin-appointments";
import { dateKeyOr } from "./date-keys";
import { zonedToUtc } from "./format";
import { shortHash } from "./security-log";
import { AUDIT_CATEGORIES, isAuditCategory, isAuditResult, type AuditCategory, type AuditResult } from "./audit-types";
import type { Db } from "./prisma-types";

/**
 * LEITURA da trilha de auditoria (página /admin/logs). Só leitura: não existe nenhuma função, Server Action ou rota
 * que altere ou apague registros de auditoria.
 *
 * AUTORIZAÇÃO: `listAuditLogs` chama `requireAdmin()` ELA MESMA (confere a sessão e o papel no banco a cada chamada).
 * Quem quer que a use no futuro (página, rota, ação) continua protegido, sem depender de lembrar de proteger o chamador.
 *
 * Limites escolhidos (o painel não tinha nenhum para logs):
 *  - página: 25 linhas por padrão, no máximo 50 (mesmo que alguém peça mais);
 *  - período padrão: últimos 30 dias; máximo de 92 dias por consulta (mesmo para datas digitadas na URL).
 */
export const AUDIT_PAGE_SIZE = 25;
export const AUDIT_MAX_PAGE_SIZE = 50;
export const AUDIT_DEFAULT_RANGE_DAYS = 30;
export const AUDIT_MAX_RANGE_DAYS = 92;
const MAX_USER_FILTER_LENGTH = 100;
const MAX_USER_MATCHES = 20;

/** Datas vindas da URL -> intervalo seguro (dias locais, fim inclusivo). `todayKey` é "hoje" em America/Sao_Paulo. */
export function resolveAuditRange(rawFrom: string | undefined, rawTo: string | undefined, todayKey: string) {
  const defaultFrom = addDaysToDateKey(todayKey, -(AUDIT_DEFAULT_RANGE_DAYS - 1));
  const fromKey = dateKeyOr(rawFrom, defaultFrom);
  let toKey = dateKeyOr(rawTo, todayKey);
  if (toKey < fromKey) toKey = fromKey;
  const maxToKey = addDaysToDateKey(fromKey, AUDIT_MAX_RANGE_DAYS - 1);
  const clamped = toKey > maxToKey;
  return { fromKey, toKey: clamped ? maxToKey : toKey, clamped };
}

/** Parâmetros crus da URL -> filtros válidos. Qualquer valor desconhecido cai no padrão. */
export function parseAuditFilters(
  raw: { aba?: string; de?: string; ate?: string; resultado?: string; usuario?: string; pagina?: string },
  todayKey: string
) {
  const category: AuditCategory = isAuditCategory(raw.aba) ? raw.aba : AUDIT_CATEGORIES[0];
  const result: AuditResult | undefined = isAuditResult(raw.resultado) ? raw.resultado : undefined;
  const usuario = (raw.usuario ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_USER_FILTER_LENGTH);
  return { category, result, usuario, page: parsePageNumber(raw.pagina), ...resolveAuditRange(raw.de, raw.ate, todayKey) };
}

export type AuditFilters = ReturnType<typeof parseAuditFilters>;

export interface AuditRow {
  id: string;
  occurredAt: Date;
  firstAt: Date;
  count: number;
  action: string;
  result: string;
  /** Quem agiu, já em texto para exibir (nome da conta, "Sistema" ou visitante não identificado). Nunca e-mail. */
  actor: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
}

/** Condição "usuário": nome (contém) ou e-mail exato -> IDs de conta e/ou hash de tentativa sem conta. */
async function userWhere(usuario: string, db: Db) {
  if (!usuario) return null;
  if (usuario.includes("@")) {
    const email = usuario.toLowerCase();
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    return { OR: [...(user ? [{ actorId: user.id }] : []), { subjectHash: shortHash(email) }] };
  }
  const users = await db.user.findMany({
    where: { name: { contains: usuario, mode: "insensitive" } },
    select: { id: true },
    take: MAX_USER_MATCHES,
  });
  return { actorId: { in: users.map((u) => u.id) } };
}

export async function listAuditLogs(
  params: { category: AuditCategory; fromKey: string; toKey: string; result?: AuditResult; usuario?: string; page: number; pageSize?: number },
  db: Db = prisma
) {
  await requireAdmin();

  // Reconfere tudo o que chega (a função pode ser chamada por outro código além da página).
  if (!isAuditCategory(params.category)) throw new Error("Categoria de log inválida.");
  const pageSize = Math.min(Math.max(1, Math.trunc(params.pageSize ?? AUDIT_PAGE_SIZE) || AUDIT_PAGE_SIZE), AUDIT_MAX_PAGE_SIZE);

  const [fy, fm, fd] = params.fromKey.split("-").map(Number);
  const [ty, tm, td] = addDaysToDateKey(params.toKey, 1).split("-").map(Number);
  const occurredAt = { gte: zonedToUtc(fy, fm, fd, 0, 0), lt: zonedToUtc(ty, tm, td, 0, 0) };

  const who = await userWhere((params.usuario ?? "").slice(0, MAX_USER_FILTER_LENGTH), db);
  const where = {
    category: params.category,
    occurredAt,
    ...(isAuditResult(params.result) ? { result: params.result } : {}),
    ...(who ?? {}),
  };

  const total = await db.auditLog.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, params.page), pageCount);

  // Mais recentes primeiro; o id desempata linhas no mesmo instante (sem isso, linhas poderiam repetir ou sumir entre páginas).
  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  // Nomes das contas em UMA consulta (sem e-mail nem celular).
  const ids = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => Boolean(v)))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const items: AuditRow[] = rows.map((r) => {
    let actor = "Sistema";
    if (r.actorId) {
      const u = byId.get(r.actorId);
      actor = u ? `${u.name} (${u.role === "ADMIN" ? "administradora" : "cliente"})` : "Conta removida";
    } else if (r.subjectHash) {
      actor = `Visitante sem conta identificada (código ${r.subjectHash})`;
    }
    return {
      id: r.id,
      occurredAt: r.occurredAt,
      firstAt: r.createdAt,
      count: r.count,
      action: r.action,
      result: r.result,
      actor,
      targetType: r.targetType,
      targetId: r.targetId,
      detail: r.detail,
    };
  });

  return { items, total, page, pageCount, pageSize };
}
