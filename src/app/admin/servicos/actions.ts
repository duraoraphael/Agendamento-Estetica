"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { serviceSchema, idSchema, formatZodError } from "@/lib/validation";
import { recordAuditTx } from "@/lib/audit-log";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { deleteService, ServiceDeleteError } from "@/lib/service-images";
import { parseReaisToCents, VEHICLE_TYPES, type PriceTable } from "@/lib/pricing";
import { saveServicePrices } from "@/lib/pricing-data";
import type { Prisma } from "@prisma/client";

export type ServiceFormState = { errors: Record<string, string>; createdId?: string } | null;

/** Preços por categoria do formulário (`price_HATCH` ... `price_VAN`, em reais). Campo vazio = sem preço específico. */
function parseTypePrices(formData: FormData): { table: PriceTable; errors: Record<string, string> } {
  const table: PriceTable = {};
  const errors: Record<string, string> = {};
  for (const type of VEHICLE_TYPES) {
    const raw = formData.get(`price_${type}`)?.toString().trim() ?? "";
    if (raw === "") continue;
    const cents = parseReaisToCents(raw);
    if (cents === null) errors[`price_${type}`] = "Informe um preço válido, ex: 90,00.";
    else table[type] = cents;
  }
  return { table, errors };
}

/** Grava os preços por categoria dentro da transação do serviço e registra (sem valores) quantas categorias ficaram. */
async function savePricesAndAudit(tx: Prisma.TransactionClient, adminId: string, serviceId: string, table: PriceTable) {
  const before = await tx.servicePrice.count({ where: { serviceId } });
  await saveServicePrices(tx, serviceId, table);
  const count = Object.keys(table).length;
  if (count === 0 && before === 0) return;
  await recordAuditTx(tx, {
    action: "service_prices_updated",
    actorId: adminId,
    targetType: "Service",
    targetId: serviceId,
    detail: `${count} ${count === 1 ? "categoria" : "categorias"}`,
  });
}

export async function upsertServiceAction(_prevState: ServiceFormState, formData: FormData): Promise<ServiceFormState> {
  const admin = await requireAdmin();

  const id = formData.get("id")?.toString();
  const { table: typePrices, errors: typePriceErrors } = parseTypePrices(formData);
  // Valor digitado em reais (ex: "40,00") é convertido para centavos aqui.
  const priceReais = formData.get("priceReais")?.toString().trim().replace(",", ".") ?? "0";
  const priceNumber = Number(priceReais);
  if (priceReais === "" || !Number.isFinite(priceNumber) || priceNumber < 0) {
    return { errors: { priceReais: "Informe um preço válido, ex: 40,00.", ...typePriceErrors } };
  }
  const priceCents = Math.round(priceNumber * 100);

  const parsed = serviceSchema.safeParse({
    name: formData.get("name"),
    priceCents,
    durationMinutes: formData.get("durationMinutes"),
    active: formData.get("active") === "on",
  });

  if (!parsed.success) {
    return { errors: { ...formatZodError(parsed.error), ...typePriceErrors } };
  }
  // Preço de categoria inválido: nada é gravado (nem o serviço, nem as outras categorias).
  if (Object.keys(typePriceErrors).length > 0) return { errors: typePriceErrors };

  if (id) {
    if (!idSchema.safeParse(id).success) return { errors: { _form: "Serviço inválido." } };
    const exists = await prisma.service.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return { errors: { _form: "Serviço não encontrado." } };
    // Mudança e registro de auditoria na MESMA transação: o log só existe se a alteração foi confirmada.
    await prisma.$transaction(async (tx) => {
      await tx.service.update({ where: { id }, data: parsed.data });
      await recordAuditTx(tx, { action: "service_updated", actorId: admin.id, targetType: "Service", targetId: id, detail: parsed.data.name });
      await savePricesAndAudit(tx, admin.id, id, typePrices);
    });
  } else {
    const createdId = await prisma.$transaction(async (tx) => {
      const created = await tx.service.create({ data: parsed.data });
      await recordAuditTx(tx, { action: "service_created", actorId: admin.id, targetType: "Service", targetId: created.id, detail: created.name });
      await savePricesAndAudit(tx, admin.id, created.id, typePrices);
      return created.id;
    });
    revalidatePath("/admin/servicos");
    // Serviço novo: NÃO redireciona. A tela envia as fotos escolhidas agora que o ID existe e só então navega
    // (se alguma foto falhar, o serviço continua criado e a tela diz quais fotos não subiram).
    return { errors: {}, createdId };
  }

  revalidatePath("/admin/servicos");
  redirect("/admin/servicos");
}

export type DeleteServiceResult = { ok: true } | { ok: false; error: string };

/**
 * Exclui um serviço que nunca foi reservado (fotos incluídas). Com reservas no histórico a exclusão é recusada: o
 * histórico e o faturamento dependem do serviço, e a saída é "Desativar". A regra vive em `deleteService` (servidor).
 */
export async function deleteServiceAction(id: string): Promise<DeleteServiceResult> {
  const admin = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Serviço inválido." };

  const limit = await hitLimit(limitKey("service-delete-admin", admin.id), RATE_LIMITS.settingsPerMinute, 60_000);
  if (limit.blocked) return { ok: false, error: "Muitas alterações seguidas. Aguarde um instante e tente de novo." };

  try {
    await deleteService({ serviceId: id, adminId: admin.id });
  } catch (err) {
    if (err instanceof ServiceDeleteError) {
      if (err.code === "NOT_FOUND") return { ok: false, error: "Serviço não encontrado. Ele já pode ter sido excluído." };
      const n = err.appointmentCount;
      const quantos = n === 0 ? "agendamentos" : n === 1 ? "1 agendamento" : `${n} agendamentos`;
      return {
        ok: false,
        error: `Este serviço tem ${quantos} no histórico e não pode ser excluído, para não apagar o histórico e o faturamento. Use "Desativar" para escondê-lo das clientes.`,
      };
    }
    console.error("Falha inesperada ao excluir serviço:", (err as { name?: string })?.name ?? "Error");
    return { ok: false, error: "Não foi possível excluir o serviço. Tente novamente." };
  }

  for (const path of ["/", "/servicos", "/agendar", "/admin/servicos"]) revalidatePath(path);
  return { ok: true };
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
