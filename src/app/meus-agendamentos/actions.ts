"use server";

import { revalidatePath } from "next/cache";
import { requireClient } from "@/lib/session";
import { cancelOwnBooking, BookingConflictError, BookingValidationError } from "@/lib/booking";
import { idSchema } from "@/lib/validation";
import { RATE_LIMITS } from "@/lib/constants";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";
import { recordAuditCoalesced } from "@/lib/audit-log";

export type CancelResult = { ok: true } | { ok: false; error: string };

/** Cancelamento pela própria cliente. Dono, situação e prazo são validados no servidor (lib/booking.ts). */
export async function cancelOwnBookingAction(appointmentId: string): Promise<CancelResult> {
  const user = await requireClient();

  const parsed = idSchema.safeParse(appointmentId);
  if (!parsed.success) return { ok: false, error: "Agendamento não encontrado." };

  // Mesmo limite de pedidos da criação de reserva (uma chave por cliente): impede o laço "reservar e cancelar".
  const write = await hitLimit(limitKey("booking-write-user", user.id), RATE_LIMITS.bookingWritesPerMinute, 60_000);
  if (write.blocked) {
    securityLog("booking_rate_limited", { userId: user.id });
    await recordAuditCoalesced({ action: "booking_rate_limited", result: "BLOQUEADO", actorId: user.id });
    return { ok: false, error: "Muitos pedidos seguidos. Aguarde um instante e tente novamente." };
  }

  try {
    await cancelOwnBooking({ appointmentId: parsed.data, clientId: user.id });
  } catch (err) {
    if (err instanceof BookingValidationError || err instanceof BookingConflictError) {
      return { ok: false, error: err.message };
    }
    console.error("Erro ao cancelar reserva:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Não foi possível cancelar agora. Tente novamente em instantes." };
  }

  revalidatePath("/meus-agendamentos");
  revalidatePath(`/meus-agendamentos/${parsed.data}`);
  revalidatePath("/admin");
  revalidatePath("/admin/agendamentos");
  revalidatePath("/admin/faturamento");
  return { ok: true };
}
