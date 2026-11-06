"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { disconnectGoogleCalendar } from "@/lib/google-calendar";
import { prisma } from "@/lib/db";
import { retryNow } from "@/lib/google-sync-queue";

export async function disconnectGoogleAction() {
  const admin = await requireAdmin();
  await disconnectGoogleCalendar(admin.id);
  revalidatePath("/admin/configuracoes/google");
}

/** Reenvia, uma a uma, todas as reservas com falha de sincronização (idempotente: não duplica eventos). */
export async function retryAllFailedAction() {
  await requireAdmin();
  const failed = await prisma.appointment.findMany({ where: { googleSyncStatus: "ERRO" }, select: { id: true }, take: 50 });
  for (const a of failed) {
    await retryNow(a.id).catch((err) => console.error("Erro ao ressincronizar:", err instanceof Error ? err.message : err));
  }
  revalidatePath("/admin/configuracoes/google");
  revalidatePath("/admin/agendamentos");
  revalidatePath("/admin");
}
