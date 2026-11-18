import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { recordAudit, recordAuditTx } from "./audit-log";
import type { Db } from "./prisma-types";
import type { ProcessedServiceImage } from "./image-processing";
import { getStorage, isStorageConfigured, serviceImagePublicUrl, StorageError } from "./storage";
import {
  SERVICE_IMAGE_BUCKET,
  SERVICE_IMAGE_MAX_PER_SERVICE,
  serviceImageAlt,
  type ServiceImageErrorCode,
} from "./service-image-config";

/**
 * Regras das fotos dos serviços (metadados no PostgreSQL, arquivos no Supabase Storage).
 *
 *  - A menor `position` é a capa. As posições são sempre 0..n-1, sem buracos: ao remover, o resto é renumerado na mesma
 *    transação, então a próxima foto vira a capa automaticamente.
 *  - Toda mudança trava a LINHA do Service (`SELECT ... FOR UPDATE`) dentro da transação. Dois envios simultâneos para o
 *    mesmo serviço são serializados e o teto de 6 vale mesmo com requisições concorrentes.
 *  - Nenhuma chamada de rede dentro da transação: o arquivo é enviado ao Storage ANTES; se o banco falhar depois, o
 *    arquivo recém-enviado é apagado (ou vai para `StorageCleanup` se o Storage também falhar).
 *  - Toda leitura/gravação confere que a foto PERTENCE ao serviço informado (`id` + `serviceId`), então um ID de foto de
 *    outro serviço, manipulado no formulário, responde como "não encontrado".
 *  - Quem chama já exigiu a sessão ADMIN. Aqui não há bytes, caminhos, URLs ou nomes de arquivo em log/auditoria.
 */
export class ServiceImagesError extends Error {
  constructor(public readonly code: ServiceImageErrorCode) {
    super(code);
    this.name = "ServiceImagesError";
  }
}

/** Trava a linha do serviço até o fim da transação. Lança NOT_FOUND se o serviço não existe. */
async function lockService(tx: Db, serviceId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Service" WHERE "id" = ${serviceId} FOR UPDATE`;
  if (rows.length === 0) throw new ServiceImagesError("NOT_FOUND");
}

/** Apaga o objeto; se o Storage falhar, guarda o caminho para a limpeza posterior. Nunca lança. */
async function removeObjectOrQueue(objectPath: string, adminId: string, serviceId: string): Promise<boolean> {
  try {
    await getStorage().remove(objectPath);
    return true;
  } catch {
    try {
      await prisma.storageCleanup.upsert({
        where: { objectPath },
        create: { bucket: SERVICE_IMAGE_BUCKET, objectPath },
        update: {},
      });
    } catch (err) {
      console.error("Falha ao registrar a limpeza pendente do Storage:", (err as { name?: string })?.name ?? "Error");
    }
    await recordAudit({
      action: "service_image_cleanup_pending",
      result: "FALHA",
      actorId: adminId,
      targetType: "Service",
      targetId: serviceId,
      detail: "Arquivo não apagado do Storage; limpeza pendente",
    });
    return false;
  }
}

/** Confere o teto antes de gastar CPU/rede (a conferência definitiva é a da transação). */
export async function assertCanAddImage(serviceId: string): Promise<void> {
  const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } });
  if (!service) throw new ServiceImagesError("NOT_FOUND");
  const count = await prisma.serviceImage.count({ where: { serviceId } });
  if (count >= SERVICE_IMAGE_MAX_PER_SERVICE) throw new ServiceImagesError("LIMIT");
  if (!isStorageConfigured()) throw new ServiceImagesError("STORAGE_NOT_CONFIGURED");
}

export async function addServiceImage(input: {
  serviceId: string;
  processed: ProcessedServiceImage;
  adminId: string;
}): Promise<{ id: string; position: number }> {
  const { serviceId, processed, adminId } = input;
  await assertCanAddImage(serviceId);

  // Nome 100% gerado aqui: nada do que o navegador enviou entra no caminho.
  const objectPath = `services/${serviceId}/${randomUUID()}.webp`;
  try {
    await getStorage().upload(objectPath, processed.bytes, processed.contentType);
  } catch (err) {
    throw new ServiceImagesError(err instanceof StorageError ? err.code : "STORAGE");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await lockService(tx, serviceId);
      const count = await tx.serviceImage.count({ where: { serviceId } });
      if (count >= SERVICE_IMAGE_MAX_PER_SERVICE) throw new ServiceImagesError("LIMIT");
      const created = await tx.serviceImage.create({
        data: {
          serviceId,
          objectPath,
          altText: "",
          position: count,
          width: processed.width,
          height: processed.height,
          sizeBytes: processed.sizeBytes,
          contentType: processed.contentType,
        },
        select: { id: true, position: true },
      });
      await recordAuditTx(tx, {
        action: "service_image_added",
        actorId: adminId,
        targetType: "Service",
        targetId: serviceId,
        detail: `Foto ${created.position + 1} de ${SERVICE_IMAGE_MAX_PER_SERVICE}`,
      });
      return created;
    });
  } catch (err) {
    // Não deixa objeto órfão: o arquivo recém-enviado não tem metadado.
    await removeObjectOrQueue(objectPath, adminId, serviceId);
    if (err instanceof ServiceImagesError) throw err;
    throw new ServiceImagesError("DATABASE");
  }
}

export async function removeServiceImage(input: {
  serviceId: string;
  imageId: string;
  adminId: string;
}): Promise<{ promotedCover: boolean; storageCleaned: boolean }> {
  const { serviceId, imageId, adminId } = input;

  const removed = await prisma.$transaction(async (tx) => {
    await lockService(tx, serviceId);
    // `serviceId` no filtro: a foto de OUTRO serviço nunca é encontrada por aqui.
    const image = await tx.serviceImage.findFirst({ where: { id: imageId, serviceId }, select: { id: true, objectPath: true, position: true } });
    if (!image) throw new ServiceImagesError("NOT_FOUND");
    await tx.serviceImage.deleteMany({ where: { id: image.id, serviceId } });
    // Fecha o buraco: quem estava depois sobe uma posição (a próxima foto vira a capa se a capa foi removida).
    const rest = await tx.serviceImage.findMany({ where: { serviceId }, orderBy: { position: "asc" }, select: { id: true, position: true } });
    for (const [index, row] of rest.entries()) {
      if (row.position !== index) await tx.serviceImage.update({ where: { id: row.id }, data: { position: index } });
    }
    await recordAuditTx(tx, {
      action: "service_image_removed",
      actorId: adminId,
      targetType: "Service",
      targetId: serviceId,
      detail: image.position === 0 ? "Foto de capa removida" : `Foto ${image.position + 1} removida`,
    });
    return { objectPath: image.objectPath, wasCover: image.position === 0, remaining: rest.length };
  });

  // Fora da transação (rede). O metadado já saiu: a vitrine não aponta mais para essa foto.
  const storageCleaned = await removeObjectOrQueue(removed.objectPath, adminId, serviceId);
  return { promotedCover: removed.wasCover && removed.remaining > 0, storageCleaned };
}

/** `orderedIds` precisa ser EXATAMENTE o conjunto de fotos do serviço (sem repetir, sem faltar, sem sobrar). */
export async function reorderServiceImages(input: { serviceId: string; orderedIds: string[]; adminId: string }): Promise<void> {
  const { serviceId, orderedIds, adminId } = input;
  await prisma.$transaction(async (tx) => {
    await lockService(tx, serviceId);
    const current = await tx.serviceImage.findMany({ where: { serviceId }, select: { id: true, position: true } });
    const known = new Set(current.map((c) => c.id));
    if (orderedIds.length !== current.length || new Set(orderedIds).size !== orderedIds.length || !orderedIds.every((id) => known.has(id))) {
      throw new ServiceImagesError("INVALID");
    }
    const before = new Map(current.map((c) => [c.id, c.position]));
    let changed = false;
    for (const [index, id] of orderedIds.entries()) {
      if (before.get(id) !== index) {
        await tx.serviceImage.update({ where: { id }, data: { position: index } });
        changed = true;
      }
    }
    if (changed) {
      const coverChanged = before.get(orderedIds[0]) !== 0;
      await recordAuditTx(tx, {
        action: "service_image_reordered",
        actorId: adminId,
        targetType: "Service",
        targetId: serviceId,
        detail: coverChanged ? "Ordem alterada; capa trocada" : "Ordem alterada",
      });
    }
  });
}

export async function updateServiceImageAlt(input: { serviceId: string; imageId: string; altText: string; adminId: string }): Promise<void> {
  const { serviceId, imageId, altText, adminId } = input;
  await prisma.$transaction(async (tx) => {
    await lockService(tx, serviceId);
    const changed = await tx.serviceImage.updateMany({ where: { id: imageId, serviceId }, data: { altText } });
    if (changed.count === 0) throw new ServiceImagesError("NOT_FOUND");
    await recordAuditTx(tx, {
      action: "service_image_alt_updated",
      actorId: adminId,
      targetType: "Service",
      targetId: serviceId,
      detail: altText ? "Texto alternativo definido" : "Texto alternativo limpo",
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Exclusão do serviço
// ---------------------------------------------------------------------------------------------------------------

/** `HAS_APPOINTMENTS`: o serviço tem reservas no histórico e por isso não pode ser excluído (só desativado). */
export class ServiceDeleteError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "HAS_APPOINTMENTS",
    public readonly appointmentCount = 0,
  ) {
    super(code);
    this.name = "ServiceDeleteError";
  }
}

/**
 * Exclui um serviço SEM reservas, com as fotos dele. Reservas guardam o serviço (histórico, faturamento): se houver
 * qualquer uma, a exclusão é recusada e a saída é desativar. A linha do serviço é travada (`FOR UPDATE`): uma reserva
 * sendo criada ao mesmo tempo segura a linha (a chave estrangeira) e a contagem abaixo já a enxerga, então não existe
 * a corrida "excluir enquanto alguém agenda". As fotos saem do banco na mesma transação (cascata); os arquivos são
 * apagados do Storage depois, fora da transação (rede), com fila de limpeza se o Storage falhar.
 */
export async function deleteService(input: { serviceId: string; adminId: string }): Promise<{ name: string; photos: number }> {
  const { serviceId, adminId } = input;
  let removed: { name: string; objectPaths: string[] };
  try {
    removed = await prisma.$transaction(async (tx) => {
      try {
        await lockService(tx, serviceId);
      } catch (err) {
        if (err instanceof ServiceImagesError) throw new ServiceDeleteError("NOT_FOUND");
        throw err;
      }
      const appointmentCount = await tx.appointment.count({ where: { serviceId } });
      if (appointmentCount > 0) throw new ServiceDeleteError("HAS_APPOINTMENTS", appointmentCount);
      const service = await tx.service.findUniqueOrThrow({ where: { id: serviceId }, select: { name: true } });
      const images = await tx.serviceImage.findMany({ where: { serviceId }, select: { objectPath: true } });
      await tx.service.delete({ where: { id: serviceId } }); // ServiceImage sai em cascata
      await recordAuditTx(tx, {
        action: "service_deleted",
        actorId: adminId,
        targetType: "Service",
        targetId: serviceId,
        detail: `${service.name} (${images.length} foto(s))`,
      });
      return { name: service.name, objectPaths: images.map((i) => i.objectPath) };
    });
  } catch (err) {
    if (err instanceof ServiceDeleteError) throw err;
    // Defesa em profundidade: se uma reserva entrou por um caminho que escapou da contagem, o banco recusa (P2003).
    if ((err as { code?: string })?.code === "P2003") throw new ServiceDeleteError("HAS_APPOINTMENTS");
    throw err;
  }

  for (const objectPath of removed.objectPaths) await removeObjectOrQueue(objectPath, adminId, serviceId);
  return { name: removed.name, photos: removed.objectPaths.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Leitura (admin e vitrine)
// ---------------------------------------------------------------------------------------------------------------

export interface ServicePhoto {
  id: string;
  url: string;
  alt: string;
  /** Texto alternativo digitado (vazio = usa o padrão). Só o painel usa. */
  altText: string;
  width: number;
  height: number;
  position: number;
}

function toPhoto(row: { id: string; objectPath: string; altText: string; width: number; height: number; position: number }, serviceName: string): ServicePhoto | null {
  const url = serviceImagePublicUrl(row.objectPath);
  if (!url) return null; // Storage não configurado: a vitrine cai no placeholder em vez de apontar para um endereço quebrado.
  return { id: row.id, url, alt: serviceImageAlt(row.altText, serviceName), altText: row.altText, width: row.width, height: row.height, position: row.position };
}

let warnedMissingTable = false;

/**
 * Leitura tolerante para a VITRINE: se a migração das fotos ainda não foi aplicada (tabela `ServiceImage` inexistente,
 * erro P2021 do Prisma), o site mostra os placeholders em vez de responder 500 (ordem "código antes da migração").
 * Só esse erro é engolido (com um aviso no log); qualquer outro continua propagando. As escritas não usam isto.
 */
async function readOrEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2021") throw err;
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.warn("Tabela ServiceImage inexistente: aplique as migrações (npm run db:deploy). Usando os placeholders.");
    }
    return empty;
  }
}

/** Todas as fotos de um serviço, da capa para a última. */
export async function listServicePhotos(serviceId: string, serviceName: string): Promise<ServicePhoto[]> {
  const rows = await readOrEmpty(() => prisma.serviceImage.findMany({ where: { serviceId }, orderBy: { position: "asc" } }), []);
  return rows.map((r) => toPhoto(r, serviceName)).filter((p): p is ServicePhoto => p !== null);
}

/** Quantas fotos cada serviço tem (uma consulta só). Serviço sem foto não aparece no mapa. */
export async function countServicePhotos(serviceIds: string[]): Promise<Map<string, number>> {
  if (serviceIds.length === 0) return new Map();
  const rows = await readOrEmpty(
    () => prisma.serviceImage.groupBy({ by: ["serviceId"], where: { serviceId: { in: serviceIds } }, _count: { _all: true } }),
    [],
  );
  return new Map(rows.map((r) => [r.serviceId, r._count._all]));
}

/** Capa (menor posição) de cada serviço informado. Serviço sem foto não aparece no mapa. */
export async function getServiceCovers(services: { id: string; name: string }[]): Promise<Map<string, ServicePhoto>> {
  const covers = new Map<string, ServicePhoto>();
  if (services.length === 0) return covers;
  const names = new Map(services.map((s) => [s.id, s.name]));
  const rows = await readOrEmpty(
    () =>
      prisma.serviceImage.findMany({
        where: { serviceId: { in: services.map((s) => s.id) } },
        orderBy: [{ serviceId: "asc" }, { position: "asc" }],
        distinct: ["serviceId"],
      }),
    [],
  );
  for (const row of rows) {
    const photo = toPhoto(row, names.get(row.serviceId) ?? "Serviço");
    if (photo) covers.set(row.serviceId, photo);
  }
  return covers;
}

/** Galeria (todas as fotos) de vários serviços de uma vez, sem uma consulta por serviço. */
export async function getServiceGalleries(services: { id: string; name: string }[]): Promise<Map<string, ServicePhoto[]>> {
  const result = new Map<string, ServicePhoto[]>();
  if (services.length === 0) return result;
  const names = new Map(services.map((s) => [s.id, s.name]));
  const rows = await readOrEmpty(
    () =>
      prisma.serviceImage.findMany({
        where: { serviceId: { in: services.map((s) => s.id) } },
        orderBy: [{ serviceId: "asc" }, { position: "asc" }],
      }),
    [],
  );
  for (const row of rows) {
    const photo = toPhoto(row, names.get(row.serviceId) ?? "Serviço");
    if (!photo) continue;
    const list = result.get(row.serviceId) ?? [];
    list.push(photo);
    result.set(row.serviceId, list);
  }
  return result;
}

/** Apaga do Storage os objetos que ficaram pendentes. Usado por `npm run storage:cleanup`. */
export async function processStorageCleanup(limit = 100): Promise<{ removed: number; failed: number }> {
  const pending = await prisma.storageCleanup.findMany({ orderBy: { createdAt: "asc" }, take: limit });
  let removed = 0;
  let failed = 0;
  for (const item of pending) {
    // Um objeto que voltou a ter metadado (não deveria) nunca é apagado por aqui.
    const stillUsed = await prisma.serviceImage.count({ where: { objectPath: item.objectPath } });
    if (stillUsed > 0) {
      await prisma.storageCleanup.delete({ where: { id: item.id } });
      continue;
    }
    try {
      await getStorage().remove(item.objectPath);
      await prisma.storageCleanup.delete({ where: { id: item.id } });
      removed++;
    } catch {
      await prisma.storageCleanup.update({ where: { id: item.id }, data: { attempts: { increment: 1 } } });
      failed++;
    }
  }
  return { removed, failed };
}
