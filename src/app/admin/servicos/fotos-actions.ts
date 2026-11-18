"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { hasNoControlChars, idSchema } from "@/lib/validation";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { securityLog } from "@/lib/security-log";
import { removeServiceImage, reorderServiceImages, ServiceImagesError, updateServiceImageAlt } from "@/lib/service-images";
import { SERVICE_IMAGE_ALT_MAX, SERVICE_IMAGE_ERRORS, SERVICE_IMAGE_MAX_PER_SERVICE } from "@/lib/service-image-config";

/**
 * Ações sobre as fotos de um serviço que JÁ existem (o envio é a rota /api/admin/servicos/[id]/fotos).
 * Uma Server Action é um endpoint público: `requireAdmin` confere a sessão e o papel no banco a cada chamada, e todo ID
 * recebido é validado e RECONFERIDO no servidor (a foto precisa pertencer ao serviço informado).
 */
export type PhotoActionResult = { ok: true } | { ok: false; error: string };

const orderSchema = z.object({
  serviceId: idSchema,
  orderedIds: z.array(idSchema).min(1).max(SERVICE_IMAGE_MAX_PER_SERVICE),
});
const removeSchema = z.object({ serviceId: idSchema, imageId: idSchema });
const altSchema = z.object({
  serviceId: idSchema,
  imageId: idSchema,
  altText: z
    .string()
    .trim()
    .max(SERVICE_IMAGE_ALT_MAX, `O texto alternativo pode ter no máximo ${SERVICE_IMAGE_ALT_MAX} caracteres.`)
    .refine((v) => hasNoControlChars(v), "O texto alternativo tem caracteres inválidos."),
});

function refresh(serviceId: string) {
  // Vitrine, fluxo de agendamento e painel mostram a capa/galeria.
  for (const path of ["/", "/servicos", "/agendar", "/admin/servicos"]) revalidatePath(path);
  revalidatePath(`/admin/servicos/${serviceId}/editar`);
}

async function guard(adminId: string): Promise<PhotoActionResult | null> {
  const limit = await hitLimit(limitKey("service-image-admin", adminId), RATE_LIMITS.serviceImageWritesPerMinute, 60_000);
  if (limit.blocked) {
    securityLog("service_image_rate_limited", { userId: adminId });
    return { ok: false, error: SERVICE_IMAGE_ERRORS.RATE_LIMITED };
  }
  return null;
}

function toResult(err: unknown): PhotoActionResult {
  if (err instanceof ServiceImagesError) return { ok: false, error: SERVICE_IMAGE_ERRORS[err.code] };
  console.error("Falha inesperada ao alterar fotos de serviço:", (err as { name?: string })?.name ?? "Error");
  return { ok: false, error: SERVICE_IMAGE_ERRORS.DATABASE };
}

export async function reorderServiceImagesAction(serviceId: string, orderedIds: string[]): Promise<PhotoActionResult> {
  const admin = await requireAdmin();
  const parsed = orderSchema.safeParse({ serviceId, orderedIds });
  if (!parsed.success) return { ok: false, error: SERVICE_IMAGE_ERRORS.INVALID };
  const blocked = await guard(admin.id);
  if (blocked) return blocked;
  try {
    await reorderServiceImages({ ...parsed.data, adminId: admin.id });
  } catch (err) {
    return toResult(err);
  }
  refresh(parsed.data.serviceId);
  return { ok: true };
}

export async function removeServiceImageAction(serviceId: string, imageId: string): Promise<PhotoActionResult> {
  const admin = await requireAdmin();
  const parsed = removeSchema.safeParse({ serviceId, imageId });
  if (!parsed.success) return { ok: false, error: SERVICE_IMAGE_ERRORS.INVALID };
  const blocked = await guard(admin.id);
  if (blocked) return blocked;
  try {
    await removeServiceImage({ ...parsed.data, adminId: admin.id });
  } catch (err) {
    return toResult(err);
  }
  refresh(parsed.data.serviceId);
  return { ok: true };
}

export async function updateServiceImageAltAction(serviceId: string, imageId: string, altText: string): Promise<PhotoActionResult> {
  const admin = await requireAdmin();
  const parsed = altSchema.safeParse({ serviceId, imageId, altText });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? SERVICE_IMAGE_ERRORS.INVALID };
  const blocked = await guard(admin.id);
  if (blocked) return blocked;
  try {
    await updateServiceImageAlt({ ...parsed.data, adminId: admin.id });
  } catch (err) {
    return toResult(err);
  }
  refresh(parsed.data.serviceId);
  return { ok: true };
}
