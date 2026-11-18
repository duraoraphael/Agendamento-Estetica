import { NextResponse } from "next/server";
import { getAdminApiUser } from "@/lib/session";
import { idSchema } from "@/lib/validation";
import { readBytesLimited, TOO_LARGE } from "@/lib/body-limit";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { processServiceImage, ServiceImageError } from "@/lib/image-processing";
import { addServiceImage, ServiceImagesError } from "@/lib/service-images";
import { securityLog } from "@/lib/security-log";
import { SERVICE_IMAGE_ERRORS, SERVICE_IMAGE_MAX_UPLOAD_BYTES, type ServiceImageErrorCode } from "@/lib/service-image-config";

/**
 * Envio de UMA foto de serviço (corpo = bytes da imagem; sem multipart, sem nome de arquivo).
 *
 * Só a administradora (NextAuth, papel conferido no banco). Ordem das barreiras, da mais barata para a mais cara:
 * origem -> sessão ADMIN -> ID -> limite de envios -> teto do corpo (8 MB) -> magic bytes + decodificação (sharp) ->
 * teto de 6 fotos sob trava do serviço -> Storage -> metadados. Visitante e cliente recebem 401, sem pistas.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<ServiceImageErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_LARGE: 413,
  EMPTY: 400,
  UNSUPPORTED: 415,
  ANIMATED: 415,
  CORRUPT: 422,
  PROCESSING: 422,
  LIMIT: 409,
  STORAGE: 502,
  STORAGE_NOT_CONFIGURED: 503,
  DATABASE: 500,
  RATE_LIMITED: 429,
  INVALID: 400,
};

function fail(code: ServiceImageErrorCode, extraHeaders?: Record<string, string>) {
  return NextResponse.json(
    { ok: false, code, error: SERVICE_IMAGE_ERRORS[code] },
    { status: STATUS[code], headers: { "Cache-Control": "no-store", ...extraHeaders } },
  );
}

/** Pedido de outro site: o navegador informa a origem; ela precisa ser a deste mesmo endereço. */
function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true; // requisição do mesmo site sem cabeçalho Origin (alguns navegadores em POST same-origin)
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return fail("FORBIDDEN");

  const admin = await getAdminApiUser();
  if (!admin) return fail("UNAUTHORIZED");

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return fail("INVALID");

  const limit = await hitLimit(limitKey("service-image-admin", admin.id), RATE_LIMITS.serviceImageWritesPerMinute, 60_000);
  if (limit.blocked) {
    securityLog("service_image_rate_limited", { userId: admin.id });
    return fail("RATE_LIMITED", { "Retry-After": String(limit.retryAfterSeconds) });
  }

  const body = await readBytesLimited(req, SERVICE_IMAGE_MAX_UPLOAD_BYTES);
  if (body === TOO_LARGE) return fail("TOO_LARGE");
  if (!body || body.byteLength === 0) return fail("EMPTY");

  try {
    const processed = await processServiceImage(body);
    const created = await addServiceImage({ serviceId: id, processed, adminId: admin.id });
    return NextResponse.json({ ok: true, id: created.id, position: created.position }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ServiceImageError || err instanceof ServiceImagesError) {
      if (err.code === "CORRUPT" || err.code === "UNSUPPORTED" || err.code === "ANIMATED") {
        securityLog("service_image_rejected", { userId: admin.id, reason: err.code });
      }
      return fail(err.code);
    }
    // Erro inesperado: nunca devolve a mensagem (pode conter detalhes do banco) nem registra o corpo.
    console.error("Falha inesperada no envio de foto de serviço:", (err as { name?: string })?.name ?? "Error");
    return fail("PROCESSING");
  }
}
