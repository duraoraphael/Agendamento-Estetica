import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { shortHash } from "./security-log";
import { AUDIT_ACTIONS, type AuditAction, type AuditResult } from "./audit-types";
import type { Db } from "./prisma-types";

/**
 * GRAVAÇÃO da trilha de auditoria (tabela AuditLog; a leitura fica em audit-log-read.ts).
 *
 * Três formas de gravar, de acordo com o tipo de evento:
 *
 *  1. `recordAuditTx(tx, ...)`: AÇÕES DE NEGÓCIO (criar/cancelar reserva, ação administrativa). Roda DENTRO da mesma
 *     transação da mudança, então o registro nasce no mesmo COMMIT: se a transação desfaz, o log some junto; e a
 *     transação nunca confirma sem o registro. É idempotente por `dedupeKey` (INSERT ... ON CONFLICT DO NOTHING):
 *     repetir a mesma operação não cria uma segunda linha. Erro de banco propaga (aborta a transação).
 *
 *  2. `recordAudit(...)`: evento isolado, fora de transação (ex.: login confirmado, conexão com o Google). Nunca lança:
 *     falhar em registrar não pode derrubar o login nem a ação já concluída.
 *
 *  3. `recordAuditCoalesced(...)`: eventos que um ATACANTE consegue gerar em volume (login recusado, bloqueios,
 *     cadastro repetido, chamada não autorizada). Em vez de uma linha por tentativa, agrega em UMA linha por
 *     (ação, quem, janela) com contador, e limita as linhas DISTINTAS por ação e janela; o excedente vai para uma
 *     única linha "agrupada". Assim a tabela não cresce sem limite e o log não vira ferramenta de negação de serviço.
 *     Também nunca lança, e é chamado DEPOIS dos limites de tentativas: não os enfraquece.
 *
 * NUNCA recebe senha, token, cookie, chave, corpo de requisição, e-mail, nome ou celular. Pessoas entram como ID
 * interno (`actorId`) ou como hash curto do e-mail (`subject` -> `subjectHash`). O texto livre (`detail`) é limpo e
 * limitado aqui, e e-mails/códigos longos que escapem são mascarados.
 */

export interface AuditInput {
  action: AuditAction;
  /** Padrão: SUCESSO. */
  result?: AuditResult;
  /** ID interno de quem agiu. Ausente = processo do sistema ou visitante não identificado. */
  actorId?: string | null;
  /** E-mail (ou outro identificador) da tentativa SEM conta identificada: só o hash curto é guardado. */
  subject?: string | null;
  /** Tipo e ID do registro afetado (ex.: "Appointment" + id). */
  targetType?: string | null;
  targetId?: string | null;
  /** Texto curto montado pelo código (ex.: "CONFIRMADA → CANCELADA"). */
  detail?: string | null;
  /** Chave de idempotência (só para recordAuditTx/recordAudit). */
  dedupeKey?: string | null;
}

const MAX_ID = 64;
const MAX_DETAIL = 200;
const MAX_TYPE = 32;
const MAX_KEY = 190;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** Limpa texto para o log: sem caracteres de controle/invisíveis, em uma linha, limitado, e sem e-mails ou códigos longos. */
export function sanitizeAuditText(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  // Corta ANTES de aplicar as expressões regulares: `\S+@\S+` em texto longo sem espaços tem custo quadrático (ReDoS).
  const cleaned = String(value)
    .slice(0, max * 4)
    .replace(CONTROL_CHARS, " ")
    .replace(/\S+@\S+/g, "[oculto]")
    .replace(/[A-Za-z0-9+/_=.-]{32,}/g, "[oculto]")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, max).join("");
}

function sanitizeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).replace(CONTROL_CHARS, "").trim().slice(0, MAX_ID);
  return v || null;
}

function buildRow(input: AuditInput, now: Date): Prisma.AuditLogCreateManyInput {
  return {
    category: AUDIT_ACTIONS[input.action].category,
    action: input.action,
    result: input.result ?? "SUCESSO",
    actorId: sanitizeId(input.actorId),
    subjectHash: input.subject ? shortHash(input.subject) : null,
    targetType: sanitizeAuditText(input.targetType, MAX_TYPE),
    targetId: sanitizeId(input.targetId),
    detail: sanitizeAuditText(input.detail, MAX_DETAIL),
    dedupeKey: input.dedupeKey ? String(input.dedupeKey).slice(0, MAX_KEY) : null,
    count: 1,
    createdAt: now,
    occurredAt: now,
  };
}

/** Resumo de erro SEM a mensagem: erros do Prisma podem trazer os valores da consulta. */
function errorSummary(err: unknown): string {
  const e = err as { name?: unknown; code?: unknown };
  return `${typeof e?.name === "string" ? e.name : "Error"}${typeof e?.code === "string" ? ` (${e.code})` : ""}`;
}

/** Grava DENTRO de uma transação (ou no client normal), de forma idempotente por `dedupeKey`. Erros propagam. */
export async function recordAuditTx(db: Db, input: AuditInput): Promise<void> {
  // createMany + skipDuplicates vira INSERT ... ON CONFLICT DO NOTHING: uma chave repetida não aborta a transação.
  await db.auditLog.createMany({ data: [buildRow(input, new Date())], skipDuplicates: true });
}

/** Grava um evento isolado. Nunca lança. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await recordAuditTx(prisma, input);
  } catch (err) {
    console.error("Falha ao gravar o log de auditoria:", errorSummary(err));
  }
}

const HOUR_MS = 60 * 60 * 1000;
/** Linhas DISTINTAS por ação e janela antes de passar a agrupar o excedente. */
export const AUDIT_MAX_DISTINCT_ROWS_PER_WINDOW = 50;

export interface CoalesceOptions {
  /** Tamanho da janela de agregação. Padrão: 1 hora. */
  windowMs?: number;
  /** Teto de linhas distintas por ação e janela. `Infinity` desliga o teto (eventos que exigem credencial válida). */
  maxDistinctRows?: number;
}

async function bump(key: string, now: Date): Promise<boolean> {
  const r = await prisma.auditLog.updateMany({ where: { dedupeKey: key }, data: { count: { increment: 1 }, occurredAt: now } });
  return r.count > 0;
}

/** Grava agregando: uma linha por (ação, quem, janela) com contador, e teto de linhas distintas. Nunca lança. */
export async function recordAuditCoalesced(input: AuditInput, options: CoalesceOptions = {}): Promise<void> {
  try {
    const now = new Date();
    const windowMs = options.windowMs ?? HOUR_MS;
    const cap = options.maxDistinctRows ?? AUDIT_MAX_DISTINCT_ROWS_PER_WINDOW;
    const bucket = Math.floor(now.getTime() / windowMs);

    const row = buildRow(input, now);
    const prefix = `c:${row.action}:`;
    const who = row.actorId ?? row.subjectHash ?? "-";
    let toWrite: Prisma.AuditLogCreateManyInput = { ...row, dedupeKey: `${prefix}${who}:${bucket}` };

    // Já existe linha desta janela para este mesmo "quem": só soma. Escrita atômica (count = count + 1).
    if (await bump(toWrite.dedupeKey as string, now)) return;

    if (Number.isFinite(cap)) {
      const distinct = await prisma.auditLog.count({
        where: { dedupeKey: { startsWith: prefix }, createdAt: { gte: new Date(bucket * windowMs) } },
      });
      if (distinct >= cap) {
        // Teto atingido: o excedente vira UMA linha "agrupada", sem identificar ninguém.
        const overflowKey = `${prefix}overflow:${bucket}`;
        if (await bump(overflowKey, now)) return;
        toWrite = {
          ...row,
          actorId: null,
          subjectHash: null,
          targetType: null,
          targetId: null,
          detail: "Muitas ocorrências diferentes nesta hora; agrupadas em uma linha.",
          dedupeKey: overflowKey,
        };
      }
    }

    // Se duas requisições chegarem juntas, só uma cria; a outra cai em "já existe" e soma.
    const created = await prisma.auditLog.createMany({ data: [toWrite], skipDuplicates: true });
    if (created.count === 0) await bump(toWrite.dedupeKey as string, now);
  } catch (err) {
    console.error("Falha ao gravar o log de auditoria:", errorSummary(err));
  }
}
