"use server";

import { revalidatePath } from "next/cache";
import { requireClient } from "@/lib/session";
import { cancelOwnBooking, BookingConflictError, BookingValidationError } from "@/lib/booking";
import { idSchema } from "@/lib/validation";

export type CancelResult = { ok: true } | { ok: false; error: string };

/** Cancelamento pela própria cliente. Dono, situação e prazo são validados no servidor (lib/booking.ts). */
export async function cancelOwnBookingAction(appointmentId: string): Promise<CancelResult> {
  const user = await requireClient();

  const parsed = idSchema.safeParse(appointmentId);
  if (!parsed.success) return { ok: false, error: "Agendamento não encontrado." };

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
