import { addMinutes } from "date-fns";
import { prisma } from "./db";
import { hasBusyConflict, isSlotAvailable } from "./availability";
import { fetchExternalBusy, syncAppointmentToGoogle } from "./google-calendar";
import { markPendingIfConnected, retryNow } from "./google-sync-queue";
import { BLOCKING_STATUSES, STATUS_LABELS } from "./constants";
import { statusUpdateSchema } from "./validation";
import { canClientCancel, getBookingPolicy, limitReachedMessage } from "./policy";
import type { Prisma } from "@prisma/client";
import type { AppointmentStatus } from "./types";

export { CalendarUnavailableError } from "./google-calendar";

export class BookingConflictError extends Error {}
export class BookingValidationError extends Error {}
/** Cliente já está no limite de reservas futuras ativas. */
export class BookingLimitError extends BookingValidationError {}

const SLOT_TAKEN_MESSAGE = "Esse horário não está mais disponível. Escolha outro horário.";

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Falhas transitórias que vale repetir: lock do SQLite ou deadlock/serialização do PostgreSQL. */
function isTransientDbError(err: unknown): boolean {
  const m = errorText(err);
  return (
    m.includes("SQLITE_BUSY") || m.includes("database is locked") ||
    m.includes("P2034") || m.includes("40001") || m.includes("40P01") || m.includes("deadlock detected") || m.includes("could not serialize")
  );
}

/** No PostgreSQL, a restrição "Appointment_no_overlap" (23P01) rejeitou uma sobreposição: equivale a horário ocupado. */
function isOverlapConstraintError(err: unknown): boolean {
  const m = errorText(err);
  return m.includes("Appointment_no_overlap") || m.includes("23P01") || m.includes("exclusion constraint");
}

const isBlocking = (status: string) => (BLOCKING_STATUSES as readonly string[]).includes(status);

/**
 * Executa `fn` numa transação serializada pelo `BookingLock`. É o ÚNICO
 * mecanismo de concorrência do sistema: criação e reativação de reservas
 * passam por aqui.
 *
 * Como funciona: a primeira instrução da transação é um UPDATE na linha única
 * `BookingLock`. Em SQLite, qualquer transação de escrita adquire um lock
 * exclusivo do banco já na primeira escrita — então, se duas operações tentarem
 * mexer na agenda ao mesmo tempo, a segunda fica bloqueada até a primeira
 * confirmar (COMMIT) e só então reavalia a disponibilidade, vendo o resultado
 * da primeira. No PostgreSQL, o UPDATE bloqueia a linha até o COMMIT (mesmo efeito), e além
 * disso a restrição EXCLUDE "Appointment_no_overlap" (prisma/postgres/migrations) é uma
 * segunda garantia, no próprio banco, contra qualquer sobreposição.
 *
 * Nada de rede acontece aqui dentro: consultas ao Google Agenda são feitas
 * ANTES, pelo chamador, e passadas por parâmetro.
 */
async function runLocked<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Primeira escrita: força a serialização. upsert garante que a linha de lock exista.
          await tx.bookingLock.upsert({
            where: { id: 1 },
            create: { id: 1, version: 1 },
            update: { version: { increment: 1 } },
          });
          return fn(tx);
        },
        { timeout: 10_000, maxWait: 10_000 }
      );
    } catch (err) {
      if (isTransientDbError(err) && attempt < maxAttempts) {
        await delay(50 * attempt);
        continue;
      }
      // Segunda linha de defesa (PostgreSQL): o próprio banco recusou a sobreposição.
      if (isOverlapConstraintError(err)) throw new BookingConflictError(SLOT_TAKEN_MESSAGE);
      throw err;
    }
  }
}

function toSyncPayload(appointment: {
  id: string;
  serviceName: string;
  startAt: Date;
  endAt: Date;
  status: string;
  googleEventId: string | null;
  client: { name: string; phone: string };
}) {
  return {
    id: appointment.id,
    serviceName: appointment.serviceName,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    googleEventId: appointment.googleEventId,
    client: { name: appointment.client.name, phone: appointment.client.phone },
  };
}

/**
 * Cria uma reserva de forma segura contra concorrência (veja `runLocked`).
 * Lança BookingValidationError / BookingConflictError / CalendarUnavailableError
 * com mensagens prontas para exibir.
 */
export async function createBooking(params: { clientId: string; serviceId: string; startAt: Date }) {
  const { clientId, serviceId, startAt } = params;

  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    throw new BookingValidationError("Horário inválido. Escolha um horário na lista de horários disponíveis.");
  }

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.active) {
    throw new BookingValidationError("Esse serviço não está mais disponível. Escolha outro serviço.");
  }

  const endAt = addMinutes(startAt, service.durationMinutes);

  // Consulta externa ANTES da transação (se a agenda conectada estiver fora do ar, recusa com aviso).
  const externalBusy = await fetchExternalBusy(startAt, endAt);

  const appointment = await runLocked(async (tx) => {
    // Limite de reservas futuras ativas por cliente, checado SOB o lock: duas solicitações
    // simultâneas da mesma cliente não conseguem ultrapassar o limite juntas.
    const { maxActiveFutureBookings } = getBookingPolicy();
    if ((await countActiveFuture(tx, clientId, new Date())) >= maxActiveFutureBookings) {
      throw new BookingLimitError(limitReachedMessage(maxActiveFutureBookings));
    }

    const available = await isSlotAvailable(startAt, service.durationMinutes, tx, undefined, externalBusy);
    if (!available) {
      throw new BookingConflictError(SLOT_TAKEN_MESSAGE);
    }

    const created = await tx.appointment.create({
      data: {
        clientId,
        serviceId: service.id,
        // Snapshot: alterações futuras no serviço não afetam reservas já criadas.
        serviceName: service.name,
        priceCents: service.priceCents,
        durationMinutes: service.durationMinutes,
        startAt,
        endAt,
        status: "CONFIRMADA",
      },
      include: { client: true },
    });
    // Fila durável: a reserva já nasce "pendente de sincronização" na mesma transação (veja google-sync-queue.ts).
    await markPendingIfConnected(tx, created.id);
    return created;
  });

  await syncAppointmentToGoogle(toSyncPayload(appointment)).catch(() => {});
  return appointment;
}

/**
 * Altera a situação de uma reserva.
 *  - Valida o status em tempo de execução (nunca grava um valor desconhecido).
 *  - CONCLUIDA e FALTA só depois do horário do atendimento.
 *  - Reativar (CANCELADA/FALTA → CONFIRMADA/CONCLUIDA) revalida o horário na mesma
 *    transação, com o mesmo BookingLock da criação, ignorando a própria reserva.
 *    Em conflito, a reserva permanece como estava.
 *  - Preço e duração históricos nunca são alterados.
 */
export async function updateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
  const parsed = statusUpdateSchema.safeParse({ status });
  if (!parsed.success) {
    throw new BookingValidationError("Situação inválida.");
  }

  const before = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!before) {
    throw new BookingValidationError("Agendamento não encontrado.");
  }

  const reactivating = !isBlocking(before.status) && isBlocking(status);
  // Consulta externa antes da transação, só quando a reserva volta a ocupar horário.
  const externalBusy = reactivating ? await fetchExternalBusy(before.startAt, before.endAt) : [];

  const appointment = await runLocked(async (tx) => {
    const current = await tx.appointment.findUnique({ where: { id: appointmentId }, include: { client: true } });
    if (!current) throw new BookingValidationError("Agendamento não encontrado.");
    if (current.status === status) return current;

    const now = new Date();

    if ((status === "CONCLUIDA" || status === "FALTA") && current.startAt.getTime() > now.getTime()) {
      throw new BookingValidationError(
        "Só é possível marcar como concluída ou falta depois do horário do atendimento."
      );
    }

    if (!isBlocking(current.status) && isBlocking(status)) {
      if (status === "CONFIRMADA" && current.startAt.getTime() <= now.getTime()) {
        throw new BookingValidationError(
          "Esse horário já passou. Para registrar o atendimento, marque como concluída ou falta."
        );
      }
      // A consulta externa só foi feita se a reserva já estava inativa ANTES da transação. Se outra
      // alteração a desativou nesse intervalo, não temos a agenda externa: pedimos para tentar de novo.
      if (!reactivating) {
        throw new BookingValidationError("A situação desta reserva mudou enquanto você a alterava. Atualize a página e tente novamente.");
      }
      // Reativar uma reserva futura também respeita o limite por cliente (a própria reserva não conta).
      const { maxActiveFutureBookings } = getBookingPolicy();
      if (
        current.startAt.getTime() > now.getTime() &&
        (await countActiveFuture(tx, current.clientId, now, current.id)) >= maxActiveFutureBookings
      ) {
        throw new BookingLimitError(
          `Não foi possível reativar: a cliente já tem ${maxActiveFutureBookings} reserva${maxActiveFutureBookings > 1 ? "s" : ""} futura${maxActiveFutureBookings > 1 ? "s" : ""} ativa${maxActiveFutureBookings > 1 ? "s" : ""} (limite configurado). A reserva continua como "${(STATUS_LABELS[current.status] ?? current.status).toLowerCase()}".`
        );
      }
      const conflict = await hasBusyConflict(current.startAt, current.endAt, tx, current.id, externalBusy);
      if (conflict) {
        throw new BookingConflictError(
          `Não foi possível reativar: esse horário já foi ocupado por outra reserva ou bloqueio. A reserva continua como "${(STATUS_LABELS[current.status] ?? current.status).toLowerCase()}".`
        );
      }
    }

    const updated = await tx.appointment.update({
      where: { id: appointmentId },
      data: { status },
      include: { client: true },
    });
    await markPendingIfConnected(tx, updated.id);
    return updated;
  });

  await syncAppointmentToGoogle(toSyncPayload(appointment)).catch(() => {});
  return appointment;
}

/**
 * Cancelamento feito pela CLIENTE, pelo site. Validado no servidor: a reserva precisa ser dela
 * (reservas de outras clientes respondem "não encontrado", sem revelar que existem), estar
 * confirmada e faltar pelo menos `clientCancelMinHours` horas. Preserva o histórico (muda só a
 * situação para CANCELADA), libera o horário e atualiza o Google Agenda quando conectado.
 */
export async function cancelOwnBooking(params: { appointmentId: string; clientId: string; now?: Date }) {
  const { appointmentId, clientId } = params;
  const { clientCancelMinHours } = getBookingPolicy();

  const appointment = await runLocked(async (tx) => {
    const now = params.now ?? new Date();
    const current = await tx.appointment.findFirst({ where: { id: appointmentId, clientId }, include: { client: true } });
    if (!current) throw new BookingValidationError("Agendamento não encontrado.");
    if (current.status !== "CONFIRMADA") {
      throw new BookingValidationError("Só é possível cancelar uma reserva confirmada.");
    }
    if (!canClientCancel(current.startAt, now, clientCancelMinHours)) {
      throw new BookingValidationError(
        clientCancelMinHours === 0
          ? "Esse atendimento já começou e não pode mais ser cancelado pelo site."
          : `O cancelamento pelo site é permitido até ${clientCancelMinHours === 1 ? "1 hora" : `${clientCancelMinHours} horas`} antes do horário. Para cancelar agora, fale com o estúdio.`
      );
    }
    const updated = await tx.appointment.update({ where: { id: appointmentId }, data: { status: "CANCELADA" }, include: { client: true } });
    await markPendingIfConnected(tx, updated.id);
    return updated;
  });

  await syncAppointmentToGoogle(toSyncPayload(appointment)).catch(() => {});
  return appointment;
}

async function countActiveFuture(tx: Prisma.TransactionClient, clientId: string, now: Date, excludeId?: string) {
  return tx.appointment.count({
    where: {
      clientId,
      status: { in: [...BLOCKING_STATUSES] },
      startAt: { gt: now },
      id: excludeId ? { not: excludeId } : undefined,
    },
  });
}

/** "Tentar novamente" do painel: zera as tentativas e sincroniza agora (idempotente, nunca duplica o evento). */
export async function retryGoogleSync(appointmentId: string) {
  try {
    await retryNow(appointmentId);
  } catch (err) {
    throw new BookingValidationError(err instanceof Error ? err.message : "Agendamento não encontrado.");
  }
}

/** Quantas reservas futuras ativas a cliente tem (para avisar na tela antes de ela escolher o horário). */
export async function countClientActiveFuture(clientId: string): Promise<number> {
  return prisma.appointment.count({
    where: { clientId, status: { in: [...BLOCKING_STATUSES] }, startAt: { gt: new Date() } },
  });
}
