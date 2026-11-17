"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { disconnectGoogleCalendar } from "@/lib/google-calendar";
import { retryFailedBatch } from "@/lib/google-sync-queue";
import { recordAudit } from "@/lib/audit-log";

/** A conexão com o Google é única para o negócio: desconectar remove a conexão atual (e resolve conexões ambíguas). */
export async function disconnectGoogleAction() {
  const admin = await requireAdmin();
  await disconnectGoogleCalendar();
  await recordAudit({ action: "google_disconnected", actorId: admin.id, targetType: "GoogleCalendarAccount" });
  revalidatePath("/admin/configuracoes/google");
}

/**
 * Reenvia as reservas com falha de sincronização (idempotente: não duplica eventos), até 50 por vez e poucas ao
 * mesmo tempo. O resultado de cada reserva fica registrado nela mesma e aparece na lista desta página.
 */
export async function retryAllFailedAction() {
  const admin = await requireAdmin();
  await retryFailedBatch();
  await recordAudit({ action: "google_retry_all", actorId: admin.id });
  revalidatePath("/admin/configuracoes/google");
  revalidatePath("/admin/agendamentos");
  revalidatePath("/admin");
}
