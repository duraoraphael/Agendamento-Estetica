"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireClient } from "@/lib/session";
import { getAppointmentForClient } from "@/lib/appointments";
import { generateSlotCandidatesForDate, isValidDateKey } from "@/lib/availability";
import { rescheduleOwnBooking, BookingConflictError, BookingValidationError, CalendarUnavailableError } from "@/lib/booking";
import { idSchema, rescheduleSchema } from "@/lib/validation";
import { RATE_LIMITS } from "@/lib/constants";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";
import { recordAuditCoalesced } from "@/lib/audit-log";
import { prisma } from "@/lib/db";

const CALENDAR_UNAVAILABLE_MESSAGE =
  "Não foi possível verificar a agenda da Garage Zero Zero agora. Tente novamente em alguns instantes.";

type SlotsResult = { slots: string[]; closed: boolean } | { error: string };

/**
 * Horários LIVRES de um dia para REAGENDAR uma reserva: mesmas regras da listagem normal, ignorando a própria reserva.
 * A reserva precisa ser da cliente (de outra pessoa = "não encontrada"), confirmada e futura.
 */
export async function getRescheduleSlotsAction(appointmentId: string, dateKey: string): Promise<SlotsResult> {
  const user = await requireClient();
  if (!idSchema.safeParse(appointmentId).success) return { error: "Agendamento não encontrado." };

  // Mesmo limite por cliente das consultas de horários (protege a cota do Google Agenda).
  const limit = await hitLimit(limitKey("slots-user", user.id), RATE_LIMITS.slotsPerMinute, 60_000);
  if (limit.blocked) {
    securityLog("slots_rate_limited", { userId: user.id });
    return { error: "Muitas consultas seguidas. Aguarde um instante e tente novamente." };
  }
  if (!isValidDateKey(dateKey)) return { error: "Data inválida." };

  const appointment = await getAppointmentForClient(appointmentId, user.id);
  if (!appointment || appointment.status !== "CONFIRMADA" || appointment.startAt.getTime() <= Date.now()) {
    return { error: "Só é possível reagendar uma reserva confirmada e futura." };
  }

  try {
    const candidates = await generateSlotCandidatesForDate(dateKey, appointment.durationMinutes, prisma, {
      cacheExternal: true,
      excludeAppointmentId: appointment.id,
    });
    return { slots: candidates.filter((c) => c.available).map((c) => c.start.toISOString()), closed: candidates.length === 0 };
  } catch (err) {
    if (err instanceof CalendarUnavailableError) return { error: CALENDAR_UNAVAILABLE_MESSAGE };
    console.error("Erro ao listar horários do reagendamento:", err);
    return { error: "Não foi possível carregar os horários. Tente novamente." };
  }
}

export type RescheduleState = { error: string; refresh?: boolean } | undefined;

/**
 * Reagendamento pela cliente. Dono, situação, política (antecedência), disponibilidade e sobreposição são validados
 * no servidor, numa transação sob o BookingLock (lib/booking.ts): se algo falhar, o horário anterior permanece.
 */
export async function rescheduleBookingAction(appointmentId: string, startAtIso: string): Promise<RescheduleState> {
  const user = await requireClient();

  const parsed = rescheduleSchema.safeParse({ appointmentId, startAtIso });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  // Mesmo limite de pedidos de reservar/cancelar (uma chave por cliente): impede laços de remarcação.
  const write = await hitLimit(limitKey("booking-write-user", user.id), RATE_LIMITS.bookingWritesPerMinute, 60_000);
  if (write.blocked) {
    securityLog("booking_rate_limited", { userId: user.id });
    await recordAuditCoalesced({ action: "booking_rate_limited", result: "BLOQUEADO", actorId: user.id });
    return { error: "Muitos pedidos seguidos. Aguarde um instante e tente novamente." };
  }

  try {
    await rescheduleOwnBooking({ appointmentId: parsed.data.appointmentId, clientId: user.id, newStartAt: new Date(parsed.data.startAtIso) });
  } catch (err) {
    // Outra cliente ocupou o horário (ou ele deixou de valer): a tela recarrega a lista e a reserva continua no horário anterior.
    if (err instanceof BookingConflictError) return { error: err.message, refresh: true };
    if (err instanceof BookingValidationError) return { error: err.message };
    if (err instanceof CalendarUnavailableError) return { error: CALENDAR_UNAVAILABLE_MESSAGE };
    console.error("Erro ao reagendar:", err instanceof Error ? err.message : err);
    return { error: "Não foi possível reagendar agora. Seu horário anterior foi mantido. Tente novamente em instantes." };
  }

  revalidatePath("/meus-agendamentos");
  revalidatePath(`/meus-agendamentos/${parsed.data.appointmentId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/agendamentos");
  redirect(`/meus-agendamentos/${encodeURIComponent(parsed.data.appointmentId)}?reagendado=1`);
}
