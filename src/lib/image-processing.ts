import sharp from "sharp";
import { detectType } from "./logo-image";
import {
  SERVICE_IMAGE_MAX_HEIGHT,
  SERVICE_IMAGE_MAX_INPUT_PIXELS,
  SERVICE_IMAGE_MAX_UPLOAD_BYTES,
  SERVICE_IMAGE_MAX_WIDTH,
  SERVICE_IMAGE_OUTPUT_TYPE,
  SERVICE_IMAGE_WEBP_QUALITY,
  type ServiceImageErrorCode,
} from "./service-image-config";

/**
 * Processamento das fotos dos serviços. Roda SEMPRE no servidor, sobre os bytes recebidos:
 *  1. tamanho máximo (8 MB) conferido nos bytes reais;
 *  2. formato pelos magic bytes (JPEG/PNG/WebP). SVG, GIF e qualquer outra coisa são recusados, não importa o que o
 *     navegador disse (`File.type`) nem a extensão do nome;
 *  3. decodificação real pelo sharp, com teto de pixels (bomba de descompressão) e `failOn: "error"` (arquivo
 *     truncado/corrompido é recusado em vez de "consertado" em silêncio);
 *  4. imagem animada é recusada;
 *  5. gira conforme a orientação EXIF, reduz para caber em 1600 × 1200 (sem ampliar, mantendo a proporção) e grava
 *     WebP. O sharp NÃO copia metadados para a saída por padrão: EXIF, GPS, ICC e XMP somem.
 * Largura, altura e tamanho finais vêm do resultado do processamento, nunca do cliente.
 */
export class ServiceImageError extends Error {
  constructor(public readonly code: ServiceImageErrorCode) {
    super(code);
    this.name = "ServiceImageError";
  }
}

export interface ProcessedServiceImage {
  bytes: Buffer;
  width: number;
  height: number;
  sizeBytes: number;
  contentType: typeof SERVICE_IMAGE_OUTPUT_TYPE;
}

export async function processServiceImage(input: Uint8Array): Promise<ProcessedServiceImage> {
  if (input.byteLength === 0) throw new ServiceImageError("EMPTY");
  if (input.byteLength > SERVICE_IMAGE_MAX_UPLOAD_BYTES) throw new ServiceImageError("TOO_LARGE");

  const detected = detectType(input);
  if (detected !== "image/jpeg" && detected !== "image/png" && detected !== "image/webp") {
    throw new ServiceImageError("UNSUPPORTED");
  }

  try {
    const source = sharp(Buffer.from(input.buffer, input.byteOffset, input.byteLength), {
      limitInputPixels: SERVICE_IMAGE_MAX_INPUT_PIXELS,
      failOn: "error",
      // Só o primeiro quadro: nunca decodifica todos os quadros de um arquivo animado.
      animated: false,
    });

    const meta = await source.metadata();
    if (!meta.width || !meta.height) throw new ServiceImageError("CORRUPT");
    if ((meta.pages ?? 1) > 1) throw new ServiceImageError("ANIMATED");

    const { data, info } = await source
      .rotate() // aplica e remove a orientação EXIF
      .resize({ width: SERVICE_IMAGE_MAX_WIDTH, height: SERVICE_IMAGE_MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
      .webp({ quality: SERVICE_IMAGE_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    if (!info.width || !info.height || data.length === 0) throw new ServiceImageError("PROCESSING");
    return { bytes: data, width: info.width, height: info.height, sizeBytes: data.length, contentType: SERVICE_IMAGE_OUTPUT_TYPE };
  } catch (err) {
    if (err instanceof ServiceImageError) throw err;
    // Arquivo truncado, cabeçalho inválido ou pixels demais: a mensagem do sharp não vai para o cliente nem para o log.
    const message = err instanceof Error ? err.message : "";
    if (/pixel limit|exceeds/i.test(message)) throw new ServiceImageError("TOO_LARGE");
    throw new ServiceImageError("CORRUPT");
  }
}
