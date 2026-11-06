import { prisma } from "@/lib/db";
import { LOGO_ALLOWED_TYPES } from "@/lib/logo-image";

// Pública de propósito: a logo aparece no login e na página inicial, antes de qualquer sessão.
// O endereço leva `?v=<versão>`; cada troca de logo muda a versão, então o navegador e as CDNs podem
// guardar a imagem por 1 ano sem nunca mostrar uma logo antiga.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const logo = await prisma.siteLogo.findUnique({ where: { id: 1 } });
  if (!logo || !(LOGO_ALLOWED_TYPES as readonly string[]).includes(logo.contentType)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const etag = `"logo-${logo.updatedAt.getTime()}"`;
  const baseHeaders: Record<string, string> = {
    ETag: etag,
    "Cache-Control": "public, max-age=31536000, immutable",
    // Defesa em profundidade: a resposta é uma imagem e nada mais — sem sniffing, sem scripts, sem embutir.
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": 'inline; filename="logo"',
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: baseHeaders });

  return new Response(new Uint8Array(logo.data), {
    status: 200,
    headers: { ...baseHeaders, "Content-Type": logo.contentType, "Content-Length": String(logo.data.length) },
  });
}
