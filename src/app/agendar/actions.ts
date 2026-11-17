"use server";

import { redirect } from "next/navigation";
import { addMinutes } from "date-fns";
import { requireClient } from "@/lib/session";
import { generateSlotCandidatesForDate, isSlotAvailable, isValidDateKey, parseDateKey } from "@/lib/availability";
import { fetchExternalBusy } from "@/lib/google-calendar";
import { prisma } from "@/lib/db";
import { createBooking, BookingConflictError, BookingValidationError, CalendarUnavailableError } from "@/lib/booking";
import { createBookingSchema, idSchema } from "@/lib/validation";
import { RATE_LIMITS } from "@/lib/constants";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";
import { recordAuditCoalesced } from "@/lib/audit-log";
import { horarioUrl } from "@/lib/booking-urls";

const CALENDAR_UNAVAILABLE_MESSAGE =
  "Não foi possível verificar a agenda do estúdio agora. Tente novamente em alguns instantes.";

type SlotsResult = { slots: string[]; closed: boolean } | { error: string };

async function guardSlotsRequest(userId: string, serviceId: string, dateKey?: string) {
  // Limite por cliente: cada consulta pode chamar o Google Agenda, e uma cota esgotada bloquearia as reservas de todas.
  // O limite e a leitura do serviço não dependem um do outro: andam juntos.
  const [limit, service] = await Promise.all([
    hitLimit(limitKey("slots-user", userId), RATE_LIMITS.slotsPerMinute, 60_000),
    idSchema.safeParse(serviceId).success ? prisma.service.findUnique({ where: { id: serviceId } }) : Promise.resolve(null),
  ]);
  if (limit.blocked) {
    securityLog("slots_rate_limited", { userId });
    return { ok: false, rateLimited: true, error: "Muitas consultas seguidas. Aguarde um instante e tente novamente." } as const;
  }
  if (dateKey !== undefined && !isValidDateKey(dateKey)) return { ok: false, error: "Data inválida." } as const;
  if (!service || !service.active) return { ok: false, error: "Esse serviço não está mais disponível." } as const;
  return { ok: true, service } as const;
}

/**
 * Horários LIVRES do dia para o serviço: só os que comportam a duração inteira do atendimento
 * (expediente, almoço, bloqueios, reservas ativas — inclusive sobreposição parcial — e agenda externa).
 * Horários ocupados, passados ou sem espaço suficiente simplesmente não são devolvidos.
 */
export async function getAvailableSlotsAction(serviceId: string, dateKey: string): Promise<SlotsResult> {
  const user = await requireClient();
  const guard = await guardSlotsRequest(user.id, serviceId, dateKey);
  if (!guard.ok) return { error: guard.error };

  try {
    const candidates = await generateSlotCandidatesForDate(dateKey, guard.service.durationMinutes, prisma, { cacheExternal: true });
    return {
      slots: candidates.filter((c) => c.available).map((c) => c.start.toISOString()),
      // Dia sem expediente (nenhum horário possível) x dia cheio: a tela usa o mesmo aviso, mas pode explicar melhor.
      closed: candidates.length === 0,
    };
  } catch (err) {
    if (err instanceof CalendarUnavailableError) return { error: CALENDAR_UNAVAILABLE_MESSAGE };
    console.error("Erro ao listar horários:", err);
    return { error: "Não foi possível carregar os horários. Tente novamente." };
  }
}

/** Quantos dias à frente a busca do próximo dia livre examina, no máximo (arquivo "use server": não exporta constantes). */
const NEXT_DAY_SEARCH_DAYS = 21;

/**
 * Resultado da busca. `rateLimited: true` = o orçamento de consultas acabou (a busca foi interrompida e NÃO
 * significa que não há horários); `{ dateKey: null }` = os dias examinados realmente não têm horário livre.
 */
export type NextDayResult = { dateKey: string | null } | { error: string; rateLimited?: true };

/**
 * Primeiro dia, depois de `afterDateKey`, que tem ao menos um horário livre (procura até 21 dias à frente).
 *
 * Cada dia examinado custa uma consulta ao banco e, com o Google conectado, possivelmente uma chamada FreeBusy.
 * Por isso o orçamento (RATE_LIMITS.nextDayLookupsPerMinute) é cobrado POR DIA, ANTES do trabalho do dia, com o
 * mesmo limitador atômico das demais ações: pedidos simultâneos da mesma cliente dividem o mesmo saldo, e a busca
 * para assim que ele acaba.
 */
export async function findNextAvailableDayAction(serviceId: string, afterDateKey: string): Promise<NextDayResult> {
  const user = await requireClient();
  const guard = await guardSlotsRequest(user.id, serviceId, afterDateKey);
  if (!guard.ok) return "rateLimited" in guard ? { error: guard.error, rateLimited: true } : { error: guard.error };

  const { year, month, day } = parseDateKey(afterDateKey);
  const budgetKey = limitKey("slots-search-user", user.id);
  try {
    for (let i = 1; i <= NEXT_DAY_SEARCH_DAYS; i++) {
      const unit = await hitLimit(budgetKey, RATE_LIMITS.nextDayLookupsPerMinute, 60_000);
      if (unit.blocked) {
        securityLog("slots_rate_limited", { userId: user.id, scope: "next-day-search" });
        return { error: "Muitas consultas seguidas. Aguarde um instante e tente novamente.", rateLimited: true };
      }
      const key = new Date(Date.UTC(year, month - 1, day + i)).toISOString().slice(0, 10);
      const candidates = await generateSlotCandidatesForDate(key, guard.service.durationMinutes, prisma, { cacheExternal: true });
      if (candidates.some((c) => c.available)) return { dateKey: key };
    }
    return { dateKey: null };
  } catch (err) {
    if (err instanceof CalendarUnavailableError) return { error: CALENDAR_UNAVAILABLE_MESSAGE };
    console.error("Erro ao procurar o próximo dia:", err);
    return { error: "Não foi possível procurar agora. Tente novamente." };
  }
}

/**
 * Conferência rápida ao tocar em "Continuar": o horário escolhido continua livre AGORA (sem cache da agenda externa)?
 * A decisão definitiva continua sendo a da confirmação, sob o bloqueio de concorrência (createBooking).
 */
export async function checkSlotStillAvailableAction(serviceId: string, startAtIso: string): Promise<{ available: boolean } | { error: string }> {
  const user = await requireClient();
  const guard = await guardSlotsRequest(user.id, serviceId);
  if (!guard.ok) return { error: guard.error };

  const startAt = new Date(startAtIso);
  if (startAtIso.length > 40 || Number.isNaN(startAt.getTime())) return { available: false };
  try {
    const endAt = addMinutes(startAt, guard.service.durationMinutes);
    const externalBusy = await fetchExternalBusy(startAt, endAt);
    return { available: await isSlotAvailable(startAt, guard.service.durationMinutes, prisma, undefined, externalBusy) };
  } catch (err) {
    if (err instanceof CalendarUnavailableError) return { error: CALENDAR_UNAVAILABLE_MESSAGE };
    console.error("Erro ao conferir horário:", err);
    return { error: "Não foi possível conferir o horário. Tente novamente." };
  }
}

export type ConfirmState = { error: string } | null;

export async function confirmBookingAction(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const user = await requireClient();

  // Mesma validação para chamadas feitas direto à Server Action (sem passar pela tela).
  const parsed = createBookingSchema.safeParse({
    serviceId: formData.get("serviceId")?.toString(),
    startAtIso: formData.get("startAtIso")?.toString(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados do agendamento incompletos. Volte e escolha o serviço e o horário novamente." };
  }

  // Limite de pedidos por cliente (compartilhado com o cancelamento): reservar e cancelar em laço não pode crescer sem fim.
  const write = await hitLimit(limitKey("booking-write-user", user.id), RATE_LIMITS.bookingWritesPerMinute, 60_000);
  if (write.blocked) {
    securityLog("booking_rate_limited", { userId: user.id });
    await recordAuditCoalesced({ action: "booking_rate_limited", result: "BLOQUEADO", actorId: user.id });
    return { error: "Muitos pedidos seguidos. Aguarde um instante e tente novamente." };
  }

  let createdId: string;
  try {
    const created = await createBooking({ clientId: user.id, serviceId: parsed.data.serviceId, startAt: new Date(parsed.data.startAtIso) });
    createdId = created.id;
  } catch (err) {
    // Outra cliente ocupou o horário (ou ele deixou de valer): volta à escolha, com a lista atualizada e o aviso.
    if (err instanceof BookingConflictError) {
      redirect(horarioUrl(parsed.data.serviceId, { conflito: true }));
    }
    if (err instanceof BookingValidationError) {
      return { error: err.message };
    }
    if (err instanceof CalendarUnavailableError) {
      return { error: CALENDAR_UNAVAILABLE_MESSAGE };
    }
    console.error("Erro ao confirmar agendamento:", err);
    return { error: "Não foi possível concluir o agendamento. Tente novamente em alguns instantes." };
  }

  // O id da reserva recém-criada vai na URL para a tela mostrar "Salvar no Google Agenda" (a posse é revalidada lá).
  redirect(`/meus-agendamentos?confirmado=${encodeURIComponent(createdId)}`);
}
