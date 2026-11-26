import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { recordAuditTx } from "./audit-log";
import { isVehicleType, resolvePrice, VEHICLE_TYPES, type PriceResolution, type PriceTable } from "./pricing";
import type { Db } from "./prisma-types";

/**
 * Leitura e gravação da chave "Cobrar por tipo de veículo" e da tabela de preços por categoria.
 *
 * NUNCA passa por cache: o preço é decidido (e gravado na reserva) a partir do que está no banco AGORA. O cache das
 * configurações do site (`getSiteSettings`, até 5 minutos) é só para textos e contatos.
 */

export async function loadPriceByTypeEnabled(db: Db = prisma): Promise<boolean> {
  const row = await db.siteSettings.findUnique({ where: { id: 1 }, select: { priceByVehicleType: true } });
  return row?.priceByVehicleType ?? false;
}

/** Tabela de preços por categoria de cada serviço pedido (serviço sem preços específicos = tabela vazia). */
export async function loadPriceTables(serviceIds: string[], db: Db = prisma): Promise<Map<string, PriceTable>> {
  const tables = new Map<string, PriceTable>(serviceIds.map((id) => [id, {}]));
  if (serviceIds.length === 0) return tables;
  const rows = await db.servicePrice.findMany({ where: { serviceId: { in: serviceIds } }, select: { serviceId: true, vehicleType: true, priceCents: true } });
  for (const row of rows) {
    if (isVehicleType(row.vehicleType)) tables.get(row.serviceId)![row.vehicleType] = row.priceCents;
  }
  return tables;
}

/** Liga ou desliga a cobrança por tipo. Mudança e auditoria na MESMA transação: o log só existe se a mudança foi gravada. */
export async function setPriceByTypeEnabled(enabled: boolean, adminId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.siteSettings.upsert({
      where: { id: 1 },
      create: { id: 1, priceByVehicleType: enabled },
      update: { priceByVehicleType: enabled },
    });
    await recordAuditTx(tx, {
      action: "pricing_mode_changed",
      actorId: adminId,
      targetType: "SiteSettings",
      targetId: "1",
      detail: enabled ? "Ligado" : "Desligado",
    });
  });
}

/** Grava os preços por categoria do serviço: atualiza as presentes e apaga as que saíram da tabela. */
export async function saveServicePrices(tx: Prisma.TransactionClient, serviceId: string, table: PriceTable): Promise<void> {
  const present = VEHICLE_TYPES.filter((t) => table[t] !== undefined);
  await tx.servicePrice.deleteMany({ where: { serviceId, vehicleType: { notIn: [...present] } } });
  for (const vehicleType of present) {
    const priceCents = table[vehicleType] as number;
    await tx.servicePrice.upsert({
      where: { serviceId_vehicleType: { serviceId, vehicleType } },
      create: { serviceId, vehicleType, priceCents },
      update: { priceCents },
    });
  }
}

/** Preço de um serviço para o tipo do veículo, com a chave e as tabelas já carregadas. */
export function priceFor(
  service: { id: string; priceCents: number },
  vehicleType: string | null,
  ctx: { enabled: boolean; tables: Map<string, PriceTable> }
): PriceResolution {
  return resolvePrice({ enabled: ctx.enabled, defaultCents: service.priceCents, table: ctx.tables.get(service.id) ?? {}, vehicleType });
}
