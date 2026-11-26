import { addMinutes } from "date-fns";
import { prisma } from "./db";
import { hasBusyConflict, isSlotAvailable } from "./availability";
import { fetchExternalBusy, syncAppointmentToGoogle } from "./google-calendar";
import { markPendingIfConnected, retryNow } from "./google-sync-queue";
import { BLOCKING_STATUSES, STATUS_LABELS } from "./constants";
import { notesSchema, statusUpdateSchema } from "./validation";
import { canClientCancel, getBookingPolicy, limitReachedMessage } from "./policy";
import { recordAuditTx } from "./audit-log";
import { loadPriceByTypeEnabled, loadPriceTables, priceFor } from "./pricing-data";
import { formatDateTimeBR } from "./format";
import type { Prisma } from "@prisma/client";
import type { AppointmentStatus } from "./types";
import type { Interval } from "./availability";

export { CalendarUnavailableError } from "./google-calendar";

export class BookingConflictError extends Error {}
export class BookingValidationError extends Error {}
/** Cliente já está no limite de reservas futuras ativas. */
export class BookingLimitError extends BookingValidationError {}
/** O valor calculado agora não é o que a cliente viu na revisão (a tabela de preços mudou). Nada foi gravado. */
export class BookingPriceChangedError extends BookingValidationError {}

const SLOT_TAKEN_MESSAGE = "Esse horário não está mais disponível. Escolha outro horário.";
const VEHICLE_REQUIRED_MESSAGE = "Escolha ou cadastre o veículo do agendamento.";
const VEHICLE_TYPE_REQUIRED_MESSAGE = "Informe o tipo do seu veículo para continuar o agendamento.";
const PRICE_CHANGED_MESSAGE = "O valor deste serviço mudou. Revise o agendamento e confirme novamente.";
const SERVICE_UNAVAILABLE_MESSAGE = "Esse serviço não está mais disponível. Escolha outro serviço.";

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Falhas transitórias que vale repetir: deadlock/serialização do PostgreSQL (e erro P2034 do Prisma). */
function isTransientDbError(err: unknown): boolean {
  const m = errorText(err);
  return (
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
 * `BookingLock`. O UPDATE trava a linha até o COMMIT — então, se duas operações
 * tentarem mexer na agenda ao mesmo tempo, a segunda fica bloqueada até a primeira
 * confirmar e só então reavalia a disponibilidade, vendo o resultado da primeira.
 * Além disso, a restrição EXCLUDE "Appointment_no_overlap" (prisma/migrations) é uma
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
export async function createBooking(params: {
  clientId: string;
  serviceId: string;
  startAt: Date;
  vehicleId: string;
  notes?: string | null;
  /** Valor que a cliente viu na revisão. Se o preço calculado agora for outro, a reserva é recusada (nada é gravado). */
  expectedPriceCents?: number;
}) {
  const { clientId, serviceId, startAt } = params;

  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    throw new BookingValidationError("Horário inválido. Escolha um horário na lista de horários disponíveis.");
  }

  // Observações: validadas de novo aqui (defesa em profundidade; a Server Action já usa o mesmo schema).
  const notesParsed = notesSchema.safeParse(params.notes ?? "");
  if (!notesParsed.success) {
    throw new BookingValidationError(notesParsed.error.issues[0]?.message ?? "Observações inválidas.");
  }
  const notes = notesParsed.data;

  // O veículo é obrigatório em novas reservas e TEM que ser da própria cliente (o ID vem do formulário: não é confiável).
  // Veículo de outra pessoa responde igual a veículo inexistente.
  if (!params.vehicleId || typeof params.vehicleId !== "string") {
    throw new BookingValidationError(VEHICLE_REQUIRED_MESSAGE);
  }
  if (!(await prisma.vehicle.findFirst({ where: { id: params.vehicleId, userId: clientId }, select: { id: true } }))) {
    throw new BookingValidationError(VEHICLE_REQUIRED_MESSAGE);
  }

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.active) {
    throw new BookingValidationError("Esse serviço não está mais disponível. Escolha outro serviço.");
  }

  const endAt = addMinutes(startAt, service.durationMinutes);

  // Pré-validação LOCAL (só banco, sem rede, fora do lock): uma solicitação que já é recusada pelas regras
  // locais não gasta a cota do Google nem é afetada por uma agenda externa fora do ar. Mesma ordem e mesmas
  // regras da transação abaixo, que continua sendo a verificação definitiva (sob o BookingLock).
  const { maxActiveFutureBookings: maxFuture } = getBookingPolicy();
  if ((await countActiveFuture(prisma, clientId, new Date())) >= maxFuture) {
    throw new BookingLimitError(limitReachedMessage(maxFuture));
  }
  if (!(await isSlotAvailable(startAt, service.durationMinutes, prisma))) {
    throw new BookingConflictError(SLOT_TAKEN_MESSAGE);
  }

  // Consulta externa ANTES da transação (se a agenda conectada estiver fora do ar, recusa com aviso).
  // Só horários que passaram nas regras locais chegam aqui.
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

    // Veículo relido SOB o lock, ainda filtrado pela dona: se foi apagado entre a conferência e agora, recusa.
    const vehicle = await tx.vehicle.findFirst({ where: { id: params.vehicleId, userId: clientId } });
    if (!vehicle) throw new BookingValidationError(VEHICLE_REQUIRED_MESSAGE);

    // Preço decidido AQUI, no servidor, sob o lock: o valor do formulário nunca é usado para cobrar. A chave, a tabela e
    // o preço padrão são relidos do banco (sem cache), então uma mudança do administrador vale na hora.
    const currentService = await tx.service.findUnique({ where: { id: service.id }, select: { priceCents: true } });
    if (!currentService) throw new BookingValidationError(SERVICE_UNAVAILABLE_MESSAGE);
    const [priceEnabled, priceTables] = await Promise.all([loadPriceByTypeEnabled(tx), loadPriceTables([service.id], tx)]);
    const price = priceFor({ id: service.id, priceCents: currentService.priceCents }, vehicle.vehicleType, { enabled: priceEnabled, tables: priceTables });
    if (price.status === "needs-type") throw new BookingValidationError(VEHICLE_TYPE_REQUIRED_MESSAGE);
    if (params.expectedPriceCents !== undefined && params.expectedPriceCents !== price.cents) {
      throw new BookingPriceChangedError(PRICE_CHANGED_MESSAGE);
    }

    const created = await tx.appointment.create({
      data: {
        clientId,
        serviceId: service.id,
        // Snapshot: alterações futuras no serviço (ou na tabela de preços) não afetam reservas já criadas.
        serviceName: service.name,
        priceCents: price.cents,
        durationMinutes: service.durationMinutes,
        // Snapshot do veículo: editar ou apagar o veículo depois não altera o histórico.
        vehicleId: vehicle.id,
        vehicleBrandSnapshot: vehicle.brand,
        vehicleModelSnapshot: vehicle.model,
        vehiclePlateSnapshot: vehicle.plate,
        vehicleTypeSnapshot: vehicle.vehicleType,
        notes,
        startAt,
        endAt,
        status: "CONFIRMADA",
      },
      include: { client: true },
    });
    // Fila durável: a reserva já nasce "pendente de sincronização" na mesma transação (veja google-sync-queue.ts).
    await markPendingIfConnected(tx, created.id);
    // Auditoria na MESMA transação: só existe se a reserva foi confirmada. A chave por reserva impede linha duplicada.
    await recordAuditTx(tx, {
      action: "booking_created",
      actorId: clientId,
      targetType: "Appointment",
      targetId: created.id,
      detail: `${created.serviceName} · ${formatDateTimeBR(created.startAt)}`,
      dedupeKey: `booking_created:${created.id}`,
    });
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
export async function updateAppointmentStatus(appointmentId: string, status: AppointmentStatus, actorId: string | null = null) {
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
    // Só chega aqui quando a situação MUDOU de fato (o caso "já estava assim" retorna antes). O updatedAt torna a chave
    // única por mudança: a mesma transição repetida depois (ex.: cancelar, reativar, cancelar) é outro evento.
    await recordAuditTx(tx, {
      action: "booking_status_changed",
      actorId,
      targetType: "Appointment",
      targetId: updated.id,
      // Só letras comuns do português (nada de setas ou símbolos): o log nunca deve poder derrubar a mudança por causa de
      // um caractere que o banco não aceita, já que o registro e a mudança dividem a mesma transação.
      detail: `De ${STATUS_LABELS[current.status] ?? current.status} para ${STATUS_LABELS[status] ?? status}`,
      dedupeKey: `booking_status:${updated.id}:${status}:${updated.updatedAt.getTime()}`,
    });
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
          : `O cancelamento pelo site é permitido até ${clientCancelMinHours === 1 ? "1 hora" : `${clientCancelMinHours} horas`} antes do horário. Para cancelar agora, fale com a Garage Zero Zero.`
      );
    }
    const updated = await tx.appointment.update({ where: { id: appointmentId }, data: { status: "CANCELADA" }, include: { client: true } });
    await markPendingIfConnected(tx, updated.id);
    await recordAuditTx(tx, {
      action: "booking_canceled_by_client",
      actorId: clientId,
      targetType: "Appointment",
      targetId: updated.id,
      detail: `${updated.serviceName} · ${formatDateTimeBR(updated.startAt)}`,
      dedupeKey: `booking_canceled:${updated.id}:${updated.updatedAt.getTime()}`,
    });
    return updated;
  });

  await syncAppointmentToGoogle(toSyncPayload(appointment)).catch(() => {});
  return appointment;
}

/** Remove de `busy` o trecho `hole` (parte inteira ou parcial de cada intervalo que ele cobre). */
export function subtractInterval(busy: Interval[], hole: Interval): Interval[] {
  const result: Interval[] = [];
  for (const b of busy) {
    if (b.end <= hole.start || b.start >= hole.end) {
      result.push(b);
      continue;
    }
    if (b.start < hole.start) result.push({ start: b.start, end: hole.start });
    if (b.end > hole.end) result.push({ start: hole.end, end: b.end });
  }
  return result;
}

/**
 * REAGENDAMENTO pela cliente: muda o horário de uma reserva futura e confirmada, mantendo serviço, preço, duração e
 * veículo. Tudo acontece numa única transação sob o `BookingLock` (a mesma da criação): ou o novo horário é gravado por
 * inteiro, ou nada muda e a reserva continua no horário anterior (atomicidade). A restrição EXCLUDE do banco é a segunda
 * barreira contra sobreposição.
 *
 * Regras (validadas no servidor):
 *  - a reserva precisa ser da cliente (de outra pessoa = "não encontrado"), estar CONFIRMADA e ser futura;
 *  - mesma antecedência mínima do cancelamento (`CLIENT_CANCEL_MIN_HOURS`), contada a partir do horário ATUAL;
 *  - o novo horário passa pelas mesmas regras de listagem/confirmação (expediente, almoço, grade de 15 min, antecedência,
 *    horizonte, bloqueios, outras reservas e agenda externa), ignorando a própria reserva;
 *  - o evento do Google desta reserva não conta como "ocupado" no trecho do horário antigo (senão mover 30 minutos
 *    conflitaria com a própria reserva).
 * Sem rede dentro da transação: a agenda externa é consultada ANTES.
 */
export async function rescheduleOwnBooking(params: { appointmentId: string; clientId: string; newStartAt: Date; now?: Date }) {
  const { appointmentId, clientId, newStartAt } = params;
  if (!(newStartAt instanceof Date) || Number.isNaN(newStartAt.getTime())) {
    throw new BookingValidationError("Horário inválido. Escolha um horário na lista de horários disponíveis.");
  }
  const { clientCancelMinHours } = getBookingPolicy();

  // Leitura prévia (sem lock) só para saber a duração e o intervalo a consultar no Google. A decisão é a de dentro da transação.
  const before = await prisma.appointment.findFirst({ where: { id: appointmentId, clientId } });
  if (!before) throw new BookingValidationError("Agendamento não encontrado.");
  const newEndAt = addMinutes(newStartAt, before.durationMinutes);
  const externalBusyRaw = await fetchExternalBusy(newStartAt, newEndAt);
  // Só descontamos o horário antigo se a reserva JÁ tem evento no Google (senão não há evento próprio a ignorar).
  const ownEvent = before.googleEventId && before.googleSyncStatus === "SINCRONIZADO";
  const externalBusy = ownEvent ? subtractInterval(externalBusyRaw, { start: before.startAt, end: before.endAt }) : externalBusyRaw;

  const appointment = await runLocked(async (tx) => {
    const now = params.now ?? new Date();
    const current = await tx.appointment.findFirst({ where: { id: appointmentId, clientId }, include: { client: true } });
    if (!current) throw new BookingValidationError("Agendamento não encontrado.");
    if (current.status !== "CONFIRMADA" || current.startAt.getTime() <= now.getTime()) {
      throw new BookingValidationError("Só é possível reagendar uma reserva confirmada e futura.");
    }
    if (!canClientCancel(current.startAt, now, clientCancelMinHours)) {
      throw new BookingValidationError(
        clientCancelMinHours === 0
          ? "Esse atendimento já começou e não pode mais ser reagendado pelo site."
          : `O reagendamento pelo site é permitido até ${clientCancelMinHours === 1 ? "1 hora" : `${clientCancelMinHours} horas`} antes do horário. Para mudar agora, fale com a Garage Zero Zero.`
      );
    }
    if (current.durationMinutes !== before.durationMinutes) {
      throw new BookingValidationError("A reserva mudou enquanto você a alterava. Atualize a página e tente novamente.");
    }
    if (newStartAt.getTime() === current.startAt.getTime()) {
      throw new BookingValidationError("Esse já é o horário do seu agendamento. Escolha outro horário.");
    }
    if (!(await isSlotAvailable(newStartAt, current.durationMinutes, tx, current.id, externalBusy, now))) {
      throw new BookingConflictError(SLOT_TAKEN_MESSAGE);
    }

    const updated = await tx.appointment.update({
      where: { id: current.id },
      // Só horário muda: serviço, preço, duração e veículo (snapshots) permanecem como foram gravados.
      data: { startAt: newStartAt, endAt: addMinutes(newStartAt, current.durationMinutes) },
      include: { client: true },
    });
    await markPendingIfConnected(tx, updated.id);
    await recordAuditTx(tx, {
      action: "booking_rescheduled",
      actorId: clientId,
      targetType: "Appointment",
      targetId: updated.id,
      detail: `${updated.serviceName} · de ${formatDateTimeBR(current.startAt)} para ${formatDateTimeBR(updated.startAt)}`,
      dedupeKey: `booking_rescheduled:${updated.id}:${updated.updatedAt.getTime()}`,
    });
    return updated;
  });

  // O evento do Google é ATUALIZADO (mesmo ID determinístico) para o novo horário; falha vira "Falha ao sincronizar" na fila.
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
