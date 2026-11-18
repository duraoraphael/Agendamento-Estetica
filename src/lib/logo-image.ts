/**
 * Validação da logo enviada pela administradora. Roda SEMPRE no servidor, sobre os bytes recebidos:
 * o tipo declarado pelo navegador (`File.type`) e a extensão do nome não são confiáveis.
 *
 *  - Formatos aceitos: PNG, JPEG e WebP, reconhecidos pela assinatura dos primeiros bytes.
 *  - SVG é recusado de propósito: pode carregar scripts e vira XSS se for aberto direto pelo link da imagem.
 *  - Tamanho máximo em bytes e dimensões lidas do próprio cabeçalho do arquivo (sem decodificar a imagem,
 *    então uma "bomba de descompressão" não é processada aqui).
 *  - A imagem é guardada como veio (sem reprocessar); quem a serve fixa o Content-Type e `nosniff`.
 */

export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_MIN_SIDE = 64;
export const LOGO_MAX_SIDE = 2048;
export const LOGO_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoContentType = (typeof LOGO_ALLOWED_TYPES)[number];

export interface ValidLogo {
  contentType: LogoContentType;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export class LogoValidationError extends Error {}

/** Texto de orientação exibido ao lado do campo de envio. */
export const LOGO_GUIDANCE = `PNG, JPEG ou WebP, até ${LOGO_MAX_BYTES / 1024} KB. Use uma imagem quadrada de pelo menos 256 × 256 px (ideal 512 × 512 px, fundo transparente em PNG); ela aparece pequena no cabeçalho e maior no login. Lados entre ${LOGO_MIN_SIDE} e ${LOGO_MAX_SIDE} px.`;

export function detectType(b: Uint8Array): LogoContentType | "svg" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  // SVG/XML: só para dar uma mensagem clara (nunca é aceito).
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg";
  return null;
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

function pngSize(b: Uint8Array): { width: number; height: number } | null {
  // Assinatura (8) + tamanho do bloco (4) + "IHDR" (4) + largura (4) + altura (4).
  if (b.length < 24 || b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    let marker = b[o + 1];
    while (marker === 0xff && o + 2 < b.length) { o++; marker = b[o + 1]; } // bytes de preenchimento
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
    const len = u16be(b, o + 2);
    if (len < 2) return null;
    // SOF0..SOF15, exceto DHT (C4), JPG (C8) e DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, o + 5), width: u16be(b, o + 7) };
    }
    o += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function validateLogo(bytes: Uint8Array, declaredType?: string): ValidLogo {
  if (bytes.length === 0) throw new LogoValidationError("O arquivo da logo está vazio.");
  if (bytes.length > LOGO_MAX_BYTES) {
    throw new LogoValidationError(`A logo é grande demais (${Math.ceil(bytes.length / 1024)} KB). O máximo é ${LOGO_MAX_BYTES / 1024} KB.`);
  }

  const type = detectType(bytes);
  if (type === "svg") {
    throw new LogoValidationError("Arquivos SVG não são aceitos por segurança. Envie a logo em PNG, JPEG ou WebP.");
  }
  if (!type) throw new LogoValidationError("Formato não reconhecido. Envie a logo em PNG, JPEG ou WebP.");
  // O tipo informado pelo navegador, quando existe, precisa concordar com o conteúdo real.
  if (declaredType && declaredType !== type && !(declaredType === "image/jpg" && type === "image/jpeg")) {
    throw new LogoValidationError("O conteúdo do arquivo não corresponde ao formato informado. Envie uma imagem PNG, JPEG ou WebP válida.");
  }

  const size = type === "image/png" ? pngSize(bytes) : type === "image/jpeg" ? jpegSize(bytes) : webpSize(bytes);
  if (!size || !size.width || !size.height) {
    throw new LogoValidationError("Não foi possível ler as dimensões da imagem. O arquivo pode estar corrompido.");
  }
  if (size.width < LOGO_MIN_SIDE || size.height < LOGO_MIN_SIDE) {
    throw new LogoValidationError(`A imagem é pequena demais (${size.width} × ${size.height} px). Use pelo menos ${LOGO_MIN_SIDE} px de cada lado.`);
  }
  if (size.width > LOGO_MAX_SIDE || size.height > LOGO_MAX_SIDE) {
    throw new LogoValidationError(`A imagem é grande demais (${size.width} × ${size.height} px). Use no máximo ${LOGO_MAX_SIDE} px de cada lado.`);
  }
  return { contentType: type, width: size.width, height: size.height, bytes };
}
