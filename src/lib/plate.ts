/**
 * Placas brasileiras. Sem dependência de servidor: usado no servidor (validação, gravação) e na tela (máscara, formato).
 *
 * Formatos aceitos (7 caracteres, depois de normalizar):
 *  - antigo:   AAA9999   (ex.: ABC1234, exibido ABC-1234)
 *  - Mercosul: AAA9A99   (ex.: ABC1D23)
 * A placa é SEMPRE guardada normalizada: maiúsculas e sem separadores (espaço, hífen, ponto). Assim "abc-1d23" e
 * "ABC1D23" são a mesma placa na comparação e na unicidade por dona.
 */
const PLATE_PATTERN = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

/** Maiúsculas, sem espaços, hífens ou pontos. Não valida: use `isValidPlate`. */
export function normalizePlate(raw: string): string {
  return raw.normalize("NFKC").toUpperCase().replace(/[\s.\-_]/g, "");
}

export function isValidPlate(normalized: string): boolean {
  return PLATE_PATTERN.test(normalized);
}

/** "ABC1234" -> "ABC-1234" (formato antigo); Mercosul não leva hífen. Entrada inválida volta como veio. */
export function formatPlate(normalized: string): string {
  if (!isValidPlate(normalized)) return normalized;
  return /^[A-Z]{3}[0-9]{4}$/.test(normalized) ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : normalized;
}

/** Máscara parcial para telas de revisão: mostra as 3 letras e os 2 últimos caracteres ("ABC••23"). */
export function maskPlate(normalized: string): string {
  if (!isValidPlate(normalized)) return "•••••••";
  return `${normalized.slice(0, 3)}••${normalized.slice(5)}`;
}
