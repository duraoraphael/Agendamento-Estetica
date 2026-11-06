"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { serviceSchema, idSchema, formatZodError } from "@/lib/validation";

export type ServiceFormState = { errors: Record<string, string> } | null;

export async function upsertServiceAction(_prevState: ServiceFormState, formData: FormData): Promise<ServiceFormState> {
  await requireAdmin();

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
    await prisma.service.update({ where: { id }, data: parsed.data });
  } else {
    await prisma.service.create({ data: parsed.data });
  }

  revalidatePath("/admin/servicos");
  redirect("/admin/servicos");
}

export async function toggleServiceActiveAction(id: string, active: boolean) {
  await requireAdmin();
  if (!idSchema.safeParse(id).success) return;
  await prisma.service.updateMany({ where: { id }, data: { active: Boolean(active) } });
  revalidatePath("/admin/servicos");
}
