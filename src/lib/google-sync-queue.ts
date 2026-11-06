import { prisma } from "./db";
import { isGoogleCalendarConnected, syncAppointmentToGoogle, clearFreeBusyCache } from "./google-calendar";
import { BLOCKING_STATUSES } from "./constants";
import type { Db } from "./prisma-types";

/**
 * Fila DURÁVEL de sincronização com o Google Agenda.
 *
 * A fila é o próprio banco: a coluna `googleSyncStatus` (PENDENTE / ERRO) com `googleSyncNextAt`
 * (quando tentar) e `googleSyncAttempts`. Por isso sobrevive a reinício, queda de energia ou deploy:
 * nada fica só na memória do processo.
 *
 *  1. Ao confirmar, reativar ou cancelar uma reserva com o Google conectado, a própria transação da reserva
 *     grava PENDENTE (só banco, sem rede). Depois do COMMIT o servidor tenta sincronizar na hora.
 *  2. Se a tentativa imediata falhar, o processo morrer ou a chamada demorar, a linha continua PENDENTE/ERRO.
 *  3. Um "trabalhador" (processGoogleSyncQueue) varre a fila periodicamente — veja src/lib/google-sync-worker.ts
 *     (temporizador no servidor) e /api/cron/google-sync (agendador externo, para hospedagem sem processo fixo).
 *  4. Falhas reagendam com espera crescente (1 min, 5 min, 15 min, 1 h, 6 h) e depois param, aparecendo no
 *     painel com o botão "Tentar novamente".
 *
 * Sem duplicar eventos: o ID do evento é determinístico por reserva (veja google-calendar.ts), então repetir,
 * ou dois trabalhadores pegarem a mesma linha, apenas reconcilia o mesmo evento.
 */

/** Marca a reserva como pendente de sincronização, dentro da transação que a alterou (sem chamadas de rede). */
export async function markPendingIfConnected(tx: Db, appointmentId: string, now: Date = new Date()): Promise<void> {
  if (!(await isGoogleCalendarConnected(tx))) return;
  await tx.appointment.update({
    where: { id: appointmentId },
    // 60 s de folga: a tentativa imediata (feita logo após o COMMIT) tem tempo de terminar antes de o trabalhador agir.
    data: { googleSyncStatus: "PENDENTE", googleSyncError: null, googleSyncAttempts: 0, googleSyncNextAt: new Date(now.getTime() + 60_000) },
  });
}

/**
 * Reservas ativas e futuras que ainda não têm evento (ex.: a conta foi conectada depois de elas existirem)
 * entram na fila. Chamado ao conectar o Google.
 */
export async function enqueueUnsyncedFuture(now: Date = new Date()): Promise<number> {
  const r = await prisma.appointment.updateMany({
    where: {
      status: { in: [...BLOCKING_STATUSES] },
      startAt: { gt: now },
      googleEventId: null,
      googleSyncStatus: { in: ["NAO_CONECTADO", "ERRO"] },
    },
    data: { googleSyncStatus: "PENDENTE", googleSyncError: null, googleSyncAttempts: 0, googleSyncNextAt: now },
  });
  // Reservas canceladas (ou com falta) enquanto o Google esteve desconectado ainda podem ter um evento vivo na
  // agenda: a fila as processa como cancelamento e remove o evento.
  const stale = await prisma.appointment.updateMany({
    where: { status: { notIn: [...BLOCKING_STATUSES] }, googleEventId: { not: null } },
    data: { googleSyncStatus: "PENDENTE", googleSyncError: null, googleSyncAttempts: 0, googleSyncNextAt: now },
  });
  return r.count + stale.count;
}

export interface QueueRunResult {
  picked: number;
  synced: number;
  failed: number;
}

const LEASE_MS = 3 * 60_000;

/** Processa até `limit` itens vencidos da fila. Seguro para rodar em paralelo em vários processos. */
export async function processGoogleSyncQueue(opts: { limit?: number; now?: Date } = {}): Promise<QueueRunResult> {
  const now = opts.now ?? new Date();
  const result: QueueRunResult = { picked: 0, synced: 0, failed: 0 };
  if (!(await isGoogleCalendarConnected(prisma))) return result;

  const due = await prisma.appointment.findMany({
    where: {
      OR: [
        { googleSyncStatus: "PENDENTE", OR: [{ googleSyncNextAt: null }, { googleSyncNextAt: { lte: now } }] },
        { googleSyncStatus: "ERRO", googleSyncNextAt: { lte: now } },
      ],
    },
    orderBy: { googleSyncNextAt: "asc" },
    take: opts.limit ?? 10,
    select: { id: true, googleSyncNextAt: true },
  });

  for (const item of due) {
    // Reserva (lease) da linha: só quem conseguir mover googleSyncNextAt a partir do valor lido processa.
    const claimed = await prisma.appointment.updateMany({
      where: { id: item.id, googleSyncNextAt: item.googleSyncNextAt },
      data: { googleSyncNextAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count === 0) continue;
    result.picked++;
    await syncAppointmentToGoogle({ id: item.id }).catch(() => {});
    const after = await prisma.appointment.findUnique({ where: { id: item.id }, select: { googleSyncStatus: true } });
    if (after?.googleSyncStatus === "SINCRONIZADO") result.synced++;
    else result.failed++;
  }
  if (result.picked > 0) clearFreeBusyCache();
  return result;
}

/** Zera as tentativas e sincroniza agora (botão "Tentar novamente" do painel). */
export async function retryNow(appointmentId: string): Promise<void> {
  const a = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true } });
  if (!a) throw new Error("Agendamento não encontrado.");
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { googleSyncStatus: "PENDENTE", googleSyncAttempts: 0, googleSyncNextAt: new Date(Date.now() + LEASE_MS) },
  });
  await syncAppointmentToGoogle({ id: appointmentId });
}

/** Resumo para o painel: quantas reservas aguardam e quais falharam. */
export async function getSyncOverview() {
  const [pending, failed] = await Promise.all([
    prisma.appointment.count({ where: { googleSyncStatus: "PENDENTE" } }),
    prisma.appointment.findMany({
      where: { googleSyncStatus: "ERRO" },
      orderBy: { startAt: "asc" },
      take: 50,
      select: {
        id: true, serviceName: true, startAt: true, status: true, googleSyncError: true, googleSyncAttempts: true, googleSyncNextAt: true,
        client: { select: { name: true } },
      },
    }),
  ]);
  return { pending, failed };
}
