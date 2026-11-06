"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import {
  updateAppointmentStatus,
  retryGoogleSync,
  BookingConflictError,
  BookingValidationError,
  CalendarUnavailableError,
} from "@/lib/booking";
import { idSchema, statusUpdateSchema } from "@/lib/validation";
import { securityLog } from "@/lib/security-log";

export type ActionResult = { ok: true } | { ok: false; error: string };

// `status` chega do navegador: o tipo TypeScript não protege em tempo de execução, então validamos aqui.
export async function changeStatusAction(id: string, status: string): Promise<ActionResult> {
  const admin = await requireAdmin();

  const parsedId = idSchema.safeParse(id);
  const parsedStatus = statusUpdateSchema.safeParse({ status });
  if (!parsedId.success || !parsedStatus.success) {
    return { ok: false, error: "Situação inválida." };
  }

  try {
    await updateAppointmentStatus(parsedId.data, parsedStatus.data.status);
    securityLog("admin_status_changed", { adminId: admin.id, appointmentId: parsedId.data, status: parsedStatus.data.status });
  } catch (err) {
    if (err instanceof BookingConflictError || err instanceof BookingValidationError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof CalendarUnavailableError) {
      return { ok: false, error: "Não foi possível verificar a agenda do Google agora. Tente novamente em instantes." };
    }
    console.error("Erro ao alterar situação:", err);
    return { ok: false, error: "Não foi possível alterar a situação. Tente novamente." };
  }

  revalidatePath("/admin/agendamentos");
  revalidatePath("/admin");
  revalidatePath("/admin/faturamento");
  return { ok: true };
}

export async function retrySyncAction(id: string) {
  await requireAdmin();
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return;
  try {
    await retryGoogleSync(parsedId.data);
  } catch (err) {
    console.error("Erro ao ressincronizar:", err instanceof Error ? err.message : err);
  }
  revalidatePath("/admin/agendamentos");
  revalidatePath("/admin");
  revalidatePath("/admin/configuracoes/google");
}

/** Marca os novos agendamentos como vistos. Chamada pelo painel (mutação autenticada), nunca durante a renderização de uma página GET. */
export async function markNotificationsSeenAction() {
  const admin = await requireAdmin();
  await prisma.user.updateMany({ where: { id: admin.id }, data: { notificationsSeenAt: new Date() } });
  revalidatePath("/admin", "layout");
}
