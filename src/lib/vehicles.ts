import { prisma } from "./db";
import { recordAuditTx } from "./audit-log";
import { LIMITS, vehicleSchema, type VehicleInput } from "./validation";
import type { Prisma } from "@prisma/client";

/** Erro com mensagem pronta para exibir (nunca contém dados de outra pessoa). */
export class VehicleError extends Error {}

const NOT_FOUND = "Veículo não encontrado.";

/**
 * TODA consulta de veículo é filtrada pelo dono (`userId`): o ID que vem da URL ou do formulário nunca é confiável.
 * Veículo de outra cliente responde "não encontrado", igual a um ID que não existe (sem revelar que existe).
 */
export async function listVehicles(userId: string) {
  return prisma.vehicle.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }] });
}

export async function getVehicleForUser(userId: string, vehicleId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.vehicle.findFirst({ where: { id: vehicleId, userId } });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

const DUPLICATE_PLATE = "Você já cadastrou um veículo com essa placa.";

export async function createVehicle(userId: string, input: VehicleInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      // O teto é conferido dentro da transação; o par (userId, placa) único no banco barra duplicidade mesmo em corrida.
      const count = await tx.vehicle.count({ where: { userId } });
      if (count >= LIMITS.vehiclesPerUserMax) {
        throw new VehicleError(`Você já tem ${LIMITS.vehiclesPerUserMax} veículos cadastrados (limite). Remova um para cadastrar outro.`);
      }
      // `data` é montado campo a campo: nada que venha do formulário além do que foi validado entra no banco
      // (sem mass assignment: `userId` vem da sessão, nunca do corpo).
      const created = await tx.vehicle.create({
        data: {
          userId,
          brand: input.brand,
          model: input.model,
          plate: input.plate,
          year: input.year,
          color: input.color,
          nickname: input.nickname,
        },
      });
      await recordAuditTx(tx, {
        action: "vehicle_created",
        actorId: userId,
        targetType: "Vehicle",
        targetId: created.id,
        dedupeKey: `vehicle_created:${created.id}`,
      });
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new VehicleError(DUPLICATE_PLATE);
    throw err;
  }
}

export async function updateVehicle(userId: string, vehicleId: string, input: VehicleInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.updateMany({
        where: { id: vehicleId, userId },
        data: { brand: input.brand, model: input.model, plate: input.plate, year: input.year, color: input.color, nickname: input.nickname },
      });
      if (updated.count === 0) throw new VehicleError(NOT_FOUND);
      await recordAuditTx(tx, {
        action: "vehicle_updated",
        actorId: userId,
        targetType: "Vehicle",
        targetId: vehicleId,
        dedupeKey: `vehicle_updated:${vehicleId}:${Date.now()}`,
      });
      return tx.vehicle.findFirst({ where: { id: vehicleId, userId } });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new VehicleError(DUPLICATE_PLATE);
    throw err;
  }
}

/** Apaga o veículo. As reservas já feitas continuam com os dados copiados (snapshot); só o vínculo vira nulo. */
export async function deleteVehicle(userId: string, vehicleId: string) {
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.vehicle.deleteMany({ where: { id: vehicleId, userId } });
    if (deleted.count === 0) throw new VehicleError(NOT_FOUND);
    await recordAuditTx(tx, {
      action: "vehicle_deleted",
      actorId: userId,
      targetType: "Vehicle",
      targetId: vehicleId,
      dedupeKey: `vehicle_deleted:${vehicleId}`,
    });
  });
}

/**
 * Lê os campos do veículo de um FormData (com o mesmo `prefix` do formulário) e valida com o schema. Só os campos
 * conhecidos entram (nada de `userId`, `id` etc. vindo do formulário: sem mass assignment).
 */
export function parseVehicleForm(formData: FormData, prefix = "") {
  const get = (name: string) => formData.get(`${prefix}${name}`)?.toString() ?? "";
  return vehicleSchema.safeParse({ brand: get("brand"), model: get("model"), plate: get("plate"), year: get("year"), color: get("color"), nickname: get("nickname") });
}

/** Erros do Zod por nome de campo (com o prefixo do formulário). */
export function vehicleFieldErrors(error: import("zod").ZodError, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = `${prefix}${String(issue.path[0] ?? "_form")}`;
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Texto de exibição: "Fiat Argo" (ou o apelido, se houver, seguido da marca e do modelo). */
export function vehicleLabel(v: { brand: string; model: string; nickname?: string | null }): string {
  const base = `${v.brand} ${v.model}`.trim();
  return v.nickname ? `${v.nickname} · ${base}` : base;
}
