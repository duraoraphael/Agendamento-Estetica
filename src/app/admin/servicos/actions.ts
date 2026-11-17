"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { serviceSchema, idSchema, formatZodError } from "@/lib/validation";
import { recordAuditTx } from "@/lib/audit-log";

export type ServiceFormState = { errors: Record<string, string> } | null;

export async function upsertServiceAction(_prevState: ServiceFormState, formData: FormData): Promise<ServiceFormState> {
  const admin = await requireAdmin();

  const id = formData.get("id")?.toString();
  // Valor digitado em reais (ex: "40,00") é convertido para centavos aqui.
  const priceReais = formData.get("priceReais")?.toString().trim().replace(",", ".") ?? "0";
  const priceNumber = Number(priceReais);
  if (priceReais === "" || !Number.isFinite(priceNumber) || priceNumber < 0) {
    return { errors: { priceReais: "Informe um preço válido, ex: 40,00." } };
  }
  const priceCents = Math.round(priceNumber * 100);

  const parsed = serviceSchema.safeParse({
    name: formData.get("name"),
    priceCents,
    durationMinutes: formData.get("durationMinutes"),
    active: formData.get("active") === "on",
  });

  if (!parsed.success) {
    return { errors: formatZodError(parsed.error) };
  }

  if (id) {
    if (!idSchema.safeParse(id).success) return { errors: { _form: "Serviço inválido." } };
    const exists = await prisma.service.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return { errors: { _form: "Serviço não encontrado." } };
    // Mudança e registro de auditoria na MESMA transação: o log só existe se a alteração foi confirmada.
    await prisma.$transaction(async (tx) => {
      await tx.service.update({ where: { id }, data: parsed.data });
      await recordAuditTx(tx, { action: "service_updated", actorId: admin.id, targetType: "Service", targetId: id, detail: parsed.data.name });
    });
  } else {
    await prisma.$transaction(async (tx) => {
      const created = await tx.service.create({ data: parsed.data });
      await recordAuditTx(tx, { action: "service_created", actorId: admin.id, targetType: "Service", targetId: created.id, detail: created.name });
    });
  }

  revalidatePath("/admin/servicos");
  redirect("/admin/servicos");
}

export async function toggleServiceActiveAction(id: string, active: boolean) {
  const admin = await requireAdmin();
  if (!idSchema.safeParse(id).success) return;
  await prisma.$transaction(async (tx) => {
    const changed = await tx.service.updateMany({ where: { id }, data: { active: Boolean(active) } });
    if (changed.count > 0) {
      await recordAuditTx(tx, { action: "service_toggled", actorId: admin.id, targetType: "Service", targetId: id, detail: active ? "Ativado" : "Desativado" });
    }
  });
  revalidatePath("/admin/servicos");
}
