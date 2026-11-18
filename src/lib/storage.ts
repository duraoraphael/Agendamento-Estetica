import { SERVICE_IMAGE_BUCKET, type ServiceImageErrorCode } from "./service-image-config";

/**
 * Cliente mínimo do Supabase Storage (API REST, sem o pacote supabase-js: só precisamos enviar e apagar).
 *
 * Segurança:
 *  - A chave `SUPABASE_SERVICE_ROLE_KEY` só existe no servidor (nunca `NEXT_PUBLIC_*`) e este módulo só é importado por
 *    código de servidor. Ela ignora o RLS do Storage, então QUEM CHAMA precisa ter conferido a sessão ADMIN antes.
 *  - O bucket é público só para LEITURA. Não existe política de INSERT/UPDATE/DELETE em `storage.objects`: o navegador
 *    (chave anon) não consegue enviar nem apagar nada; toda escrita passa por aqui, depois do NextAuth.
 *  - Nada de bytes, chave, URL ou nome de arquivo vai para o log; só o código HTTP.
 */
export class StorageError extends Error {
  constructor(public readonly code: Extract<ServiceImageErrorCode, "STORAGE" | "STORAGE_NOT_CONFIGURED">) {
    super(code);
    this.name = "StorageError";
  }
}

export interface StorageAdapter {
  /** Envia o objeto. Falha se o caminho já existe (nunca sobrescreve). */
  upload(objectPath: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Apaga o objeto. Objeto que já não existe conta como sucesso. */
  remove(objectPath: string): Promise<void>;
}

const OBJECT_PATH_RE = /^services\/[A-Za-z0-9_-]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

/** Só caminhos gerados pelo servidor (services/{id}/{uuid}.webp): impede path traversal e caminhos livres. */
export function isValidServiceObjectPath(objectPath: string): boolean {
  return OBJECT_PATH_RE.test(objectPath);
}

/** Base do projeto (`https://<ref>.supabase.co`), sem barra final. `null` se não configurada ou inválida. */
export function getSupabaseBaseUrl(): string | null {
  const raw = (process.env.SUPABASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !local) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isStorageConfigured(): boolean {
  if (override) return true;
  return Boolean(getSupabaseBaseUrl() && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim());
}

/** Endereço público de leitura (bucket público). Só para montar `next/image`; não carrega segredo. */
export function serviceImagePublicUrl(objectPath: string): string | null {
  const base = getSupabaseBaseUrl();
  if (!base || !isValidServiceObjectPath(objectPath)) return null;
  return `${base}/storage/v1/object/public/${SERVICE_IMAGE_BUCKET}/${objectPath}`;
}

const TIMEOUT_MS = 20_000;

function credentials(): { base: string; key: string } {
  const base = getSupabaseBaseUrl();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!base || !key) throw new StorageError("STORAGE_NOT_CONFIGURED");
  return { base, key };
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    // Rede/tempo esgotado: sem detalhes (a mensagem do fetch pode conter a URL).
    throw new StorageError("STORAGE");
  }
}

const supabaseStorage: StorageAdapter = {
  async upload(objectPath, bytes, contentType) {
    if (!isValidServiceObjectPath(objectPath)) throw new StorageError("STORAGE");
    const { base, key } = credentials();
    const res = await call(`${base}/storage/v1/object/${SERVICE_IMAGE_BUCKET}/${objectPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": contentType,
        // Caminho aleatório e imutável: o navegador/CDN podem guardar por 1 ano. Nunca sobrescreve.
        "cache-control": "max-age=31536000",
        "x-upsert": "false",
      },
      body: Buffer.from(bytes),
    });
    if (!res.ok) {
      console.error(`Storage: falha ao enviar objeto (HTTP ${res.status}).`);
      throw new StorageError("STORAGE");
    }
  },

  async remove(objectPath) {
    if (!isValidServiceObjectPath(objectPath)) throw new StorageError("STORAGE");
    const { base, key } = credentials();
    const res = await call(`${base}/storage/v1/object/${SERVICE_IMAGE_BUCKET}/${objectPath}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
    if (res.ok || res.status === 404) return;
    console.error(`Storage: falha ao apagar objeto (HTTP ${res.status}).`);
    throw new StorageError("STORAGE");
  },
};

let override: StorageAdapter | null = null;

/** Só para testes: troca o Storage por um falso (em memória). `null` volta ao Supabase. */
export function setStorageForTests(adapter: StorageAdapter | null): void {
  override = adapter;
}

export function getStorage(): StorageAdapter {
  return override ?? supabaseStorage;
}

/**
 * Cria o bucket público `service-images` (idempotente). Usado por `npm run storage:setup`.
 * Limita o tamanho e o tipo no próprio bucket (segunda barreira: o servidor já envia só WebP de até 8 MB).
 */
export async function ensureServiceImageBucket(): Promise<"created" | "exists"> {
  const { base, key } = credentials();
  const headers = { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
  const body = JSON.stringify({
    id: SERVICE_IMAGE_BUCKET,
    name: SERVICE_IMAGE_BUCKET,
    public: true,
    file_size_limit: 8 * 1024 * 1024,
    allowed_mime_types: ["image/webp"],
  });
  const res = await call(`${base}/storage/v1/bucket`, { method: "POST", headers, body });
  if (res.ok) return "created";
  // Já existe: a API responde 400/409 com "Duplicate". Confere o estado do bucket em vez de depender do texto.
  const check = await call(`${base}/storage/v1/bucket/${SERVICE_IMAGE_BUCKET}`, { method: "GET", headers });
  if (check.ok) return "exists";
  throw new StorageError("STORAGE");
}
