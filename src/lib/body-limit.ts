/** Marcador devolvido quando o corpo da requisição passa do limite. */
export const TOO_LARGE = Symbol("too-large");

/**
 * Lê o corpo JSON de uma requisição SEM carregar mais que `maxBytes` na memória: confere o
 * Content-Length e, como ele pode faltar ou mentir, conta os bytes à medida que chegam e aborta ao
 * passar do limite. Devolve `null` para JSON inválido e TOO_LARGE para corpo grande demais.
 */
export async function readJsonLimited(request: Request, maxBytes: number): Promise<unknown | null | typeof TOO_LARGE> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return TOO_LARGE;

  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
