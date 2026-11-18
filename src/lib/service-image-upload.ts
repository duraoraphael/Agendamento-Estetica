import {
  SERVICE_IMAGE_ERRORS,
  SERVICE_IMAGE_INPUT_TYPES,
  SERVICE_IMAGE_MAX_UPLOAD_BYTES,
} from "./service-image-config";

/**
 * Lado do NAVEGADOR do envio de fotos. Sem dependências de servidor.
 * A conferência aqui é só para dar resposta rápida; o servidor repete tudo (magic bytes, tamanho, decodificação).
 */
export type UploadResult = { ok: true } | { ok: false; error: string; code?: string };

/** Mensagem para um arquivo que nem vale a pena enviar, ou `null` se parece válido. */
export function precheckFile(file: File): string | null {
  if (file.size === 0) return SERVICE_IMAGE_ERRORS.EMPTY;
  if (file.size > SERVICE_IMAGE_MAX_UPLOAD_BYTES) return SERVICE_IMAGE_ERRORS.TOO_LARGE;
  // `file.type` vem do navegador e NÃO é confiável (o servidor confere os bytes); aqui só evita SVG/GIF óbvios.
  if (file.type && !(SERVICE_IMAGE_INPUT_TYPES as readonly string[]).includes(file.type)) return SERVICE_IMAGE_ERRORS.UNSUPPORTED;
  return null;
}

/** Envia UMA foto (corpo = bytes). `XMLHttpRequest` porque `fetch` não informa o progresso do envio. */
export function uploadServiceImage(serviceId: string, file: File, onProgress?: (fraction: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/admin/servicos/${encodeURIComponent(serviceId)}/fotos`);
    // Tipo não simples: outro site não consegue enviar este pedido sem pré-verificação (CORS) que o servidor não responde.
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.timeout = 60_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: { ok?: boolean; error?: string; code?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok) return resolve({ ok: true });
      resolve({ ok: false, error: body?.error ?? "Não foi possível enviar a foto.", code: body?.code });
    };
    xhr.onerror = () => resolve({ ok: false, error: "Erro de rede. Verifique a conexão e tente novamente.", code: "NETWORK" });
    xhr.ontimeout = () => resolve({ ok: false, error: "O envio demorou demais. Tente novamente.", code: "NETWORK" });
    xhr.send(file);
  });
}
