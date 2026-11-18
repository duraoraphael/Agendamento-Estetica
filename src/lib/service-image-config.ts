/**
 * Limites e textos das fotos dos serviços. SEM dependências de servidor: o formulário (cliente) e as rotas usam os
 * mesmos números, mas quem decide de verdade é sempre o servidor.
 */
export const SERVICE_IMAGE_BUCKET = "service-images";
export const SERVICE_IMAGE_MAX_PER_SERVICE = 6;
/** Tamanho máximo do arquivo ANTES do processamento. */
export const SERVICE_IMAGE_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const SERVICE_IMAGE_MAX_WIDTH = 1600;
export const SERVICE_IMAGE_MAX_HEIGHT = 1200;
export const SERVICE_IMAGE_WEBP_QUALITY = 82;
/** Teto de pixels decodificados (proteção contra "bomba de descompressão"): 40 megapixels. */
export const SERVICE_IMAGE_MAX_INPUT_PIXELS = 40_000_000;
export const SERVICE_IMAGE_ALT_MAX = 160;
/** Formatos aceitos no ENVIO (a saída é sempre WebP). */
export const SERVICE_IMAGE_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const SERVICE_IMAGE_OUTPUT_TYPE = "image/webp";

export const SERVICE_IMAGE_GUIDANCE = `JPEG, PNG ou WebP, até ${SERVICE_IMAGE_MAX_UPLOAD_BYTES / 1024 / 1024} MB cada. A foto é convertida para WebP (até ${SERVICE_IMAGE_MAX_WIDTH} × ${SERVICE_IMAGE_MAX_HEIGHT} px) e perde os metadados (como a localização).`;

/** Códigos estáveis de erro (a rota responde com eles; a tela mostra o texto). */
export const SERVICE_IMAGE_ERRORS = {
  UNAUTHORIZED: "Sessão administrativa necessária.",
  FORBIDDEN: "Origem da requisição não permitida.",
  NOT_FOUND: "Serviço ou foto não encontrado.",
  TOO_LARGE: `A foto é grande demais. O máximo é ${SERVICE_IMAGE_MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
  EMPTY: "O arquivo está vazio.",
  UNSUPPORTED: "Formato não aceito. Envie JPEG, PNG ou WebP (SVG e GIF não são aceitos).",
  ANIMATED: "Imagens animadas não são aceitas. Envie uma foto estática.",
  CORRUPT: "Não foi possível ler a imagem. O arquivo pode estar corrompido.",
  PROCESSING: "Não foi possível processar a foto. Tente outra imagem.",
  LIMIT: `Este serviço já tem ${SERVICE_IMAGE_MAX_PER_SERVICE} fotos. Remova uma para adicionar outra.`,
  STORAGE: "Não foi possível guardar a foto no armazenamento. Tente novamente em instantes.",
  STORAGE_NOT_CONFIGURED: "O armazenamento de fotos ainda não foi configurado no servidor.",
  DATABASE: "Não foi possível salvar a foto. Tente novamente.",
  RATE_LIMITED: "Muitos envios seguidos. Aguarde um instante e tente novamente.",
  INVALID: "Dados inválidos.",
} as const;
export type ServiceImageErrorCode = keyof typeof SERVICE_IMAGE_ERRORS;

/** Texto alternativo quando a administração não escreve um. Sem "imagem"/"foto de". */
export function serviceImageAlt(altText: string | null | undefined, serviceName: string): string {
  const own = (altText ?? "").trim();
  return own || `${serviceName} — Garage Zero Zero`;
}
