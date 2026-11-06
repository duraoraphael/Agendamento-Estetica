import crypto from "node:crypto";
import { isIP } from "node:net";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { RATE_LIMIT_WINDOW_MS } from "./constants";

/**
 * Limite de tentativas com janela fixa de 15 minutos, guardado no banco
 * (tabela RateLimit) para valer entre processos e reinícios.
 *
 * - `peek` consulta sem contar; `hit` conta uma tentativa; `reset` zera.
 * - Toda contagem é uma escrita condicional atômica (incrementar janela ativa / reiniciar
 *   janela expirada / criar chave nova), então rajadas paralelas contam todas as tentativas.
 *   Quem usa o limite deve RESERVAR a tentativa (`hitLimit`) ANTES de verificar a senha;
 *   olhar (`peekLimit`) e só contar depois seria uma corrida do tipo "checa e depois age".
 * - As chaves são hashes (SHA-256) do e-mail normalizado/IP: o banco não guarda esses dados em claro.
 */

export type LimitStatus = { blocked: boolean; retryAfterSeconds: number };

export function normalizeEmailForLimit(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

export function limitKey(scope: string, value: string): string {
  return `${scope}:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function windowStartCutoff(now: Date, windowMs: number) {
  return new Date(now.getTime() - windowMs);
}

export async function peekLimit(key: string, limit: number, windowMs = RATE_LIMIT_WINDOW_MS, now = new Date()): Promise<LimitStatus> {
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  if (!row || row.windowStart <= windowStartCutoff(now, windowMs)) return { blocked: false, retryAfterSeconds: 0 };
  if (row.count < limit) return { blocked: false, retryAfterSeconds: 0 };
  const retryMs = row.windowStart.getTime() + windowMs - now.getTime();
  return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
}

/**
 * Conta uma tentativa e devolve o estado resultante. Aqui `limit` é o número de
 * tentativas PERMITIDAS na janela: a tentativa de número limit+1 já vem bloqueada.
 * (`peekLimit`, usado no login antes de verificar a senha, bloqueia ao ATINGIR o
 * limite de falhas já contadas — mesma política: 5 falhas liberadas, a 6ª tentativa é barrada.)
 */
export async function hitLimit(key: string, limit: number, windowMs = RATE_LIMIT_WINDOW_MS, now = new Date()): Promise<LimitStatus> {
  const cutoff = windowStartCutoff(now, windowMs);

  // Cada passo é uma escrita CONDICIONAL atômica, então rajadas paralelas não se perdem,
  // nem numa chave nova ou expirada:
  //  1. janela ativa -> incrementa;  2. janela expirada -> reinicia com 1;  3. não existe -> cria
  //  (se outro processo criou no meio, a criação falha por chave duplicada e voltamos ao passo 1).
  for (let attempt = 0; attempt < 12; attempt++) {
    const active = await withBusyRetry(() =>
      prisma.rateLimit.updateMany({ where: { key, windowStart: { gt: cutoff } }, data: { count: { increment: 1 } } })
    );
    if (active.count > 0) break;

    const expired = await withBusyRetry(() =>
      prisma.rateLimit.updateMany({ where: { key, windowStart: { lte: cutoff } }, data: { count: 1, windowStart: now } })
    );
    if (expired.count > 0) break;

    try {
      await withBusyRetry(() => prisma.rateLimit.create({ data: { key, count: 1, windowStart: now } }));
      break;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }

  void cleanupExpired(now, windowMs);
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  if (!row || row.count <= limit) return { blocked: false, retryAfterSeconds: 0 };
  const retryMs = row.windowStart.getTime() + windowMs - now.getTime();
  return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
}

export async function resetLimit(key: string): Promise<void> {
  await withBusyRetry(() => prisma.rateLimit.deleteMany({ where: { key } }));
}

/** Devolve uma tentativa reservada (ex.: login bem-sucedido não deve consumir o limite por IP). */
export async function refundLimit(key: string): Promise<void> {
  await withBusyRetry(() => prisma.rateLimit.updateMany({ where: { key, count: { gt: 0 } }, data: { count: { decrement: 1 } } }));
}

/** O limitador escreve no mesmo arquivo SQLite das reservas: repete poucas vezes em caso de lock transitório. */
async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const busy = message.includes("SQLITE_BUSY") || message.includes("database is locked") || message.includes("Timed out");
      if (!busy || attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 40 * attempt));
    }
  }
}

let lastCleanup = 0;
async function cleanupExpired(now: Date, windowMs: number) {
  // No máximo uma limpeza por minuto por processo.
  if (now.getTime() - lastCleanup < 60_000) return;
  lastCleanup = now.getTime();
  await prisma.rateLimit
    .deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - windowMs * 2) } } })
    .catch(() => {});
}

/**
 * IP do cliente. Cabeçalhos como X-Forwarded-For são FORJÁVEIS por qualquer
 * cliente, então só são considerados se a aplicação estiver atrás de proxy
 * confiável, declarado em TRUSTED_PROXY_HOPS (nº de proxies confiáveis à frente
 * da aplicação, ex.: 1 para um único proxy/CDN). Nesse caso usamos a entrada
 * que o PRIMEIRO proxy confiável da cadeia (de fora para dentro) registrou:
 * a N-ésima a partir da direita. Sem a variável (padrão), retorna null e o
 * limite por IP fica desativado (o limite por e-mail continua valendo).
 */
export function getClientIp(headers: { get(name: string): string | null }, env: Record<string, string | undefined> = process.env): string | null {
  const hops = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "", 10);
  if (!Number.isInteger(hops) || hops < 1) return null;

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
  const candidate = parts[parts.length - hops];
  // Valida o formato: lixo ou valores forjados fora do padrão não viram chave.
  return candidate && isIP(candidate) ? candidate : null;
}
