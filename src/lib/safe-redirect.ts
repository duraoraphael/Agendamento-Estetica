/**
 * Aceita como destino pós-login somente um caminho DO PRÓPRIO SITE (ex.: "/meus-agendamentos?x=1").
 * Qualquer outra coisa (URL externa, "//host", "/\host", "javascript:", caracteres de controle) vira "/".
 */
export function safeCallbackPath(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "/";
   
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  try {
    const base = "http://same-origin.invalid";
    const resolved = new URL(value, base);
    if (resolved.origin !== base) return "/";
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return "/";
  }
}
