/**
 * Restaura um backup (.dump do pg_dump) em um banco PostgreSQL de DESTINO. Pensado para restaurar em um banco
 * NOVO (ex.: outro projeto Supabase ou um banco local) e conferir antes de apontar a aplicação para ele.
 *
 *   npx tsx scripts/restore.ts <arquivo.dump> --target "postgresql://..." [--force] [--allow-live]
 *
 * Proteções:
 *  - Recusa restaurar sobre o banco em uso (o apontado por DATABASE_URL/DIRECT_URL) sem --allow-live. Pare a aplicação antes.
 *  - pg_restore em uma única transação e parando no primeiro erro (nada fica pela metade).
 *  - --force remove (--clean --if-exists) os objetos existentes antes de restaurar; sem ele, destino com dados falha.
 *  Requer PG_BIN_DIR ou pg_restore no PATH.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sameDatabase(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.hostname === y.hostname && (x.port || "5432") === (y.port || "5432") && x.pathname === y.pathname;
  } catch {
    return false;
  }
}

function main() {
  const file = process.argv[2];
  const target = arg("target");
  const force = process.argv.includes("--force");
  const allowLive = process.argv.includes("--allow-live");
  if (!file || !target || file.startsWith("--")) {
    console.error("Uso: restore.ts <arquivo.dump> --target <url-postgresql-do-destino> [--force] [--allow-live]");
    process.exit(64);
  }
  if (!fs.existsSync(file)) throw new Error(`Arquivo de backup não encontrado: ${file}`);
  if (!/^postgres(ql)?:/.test(target)) throw new Error("O destino precisa ser uma URL PostgreSQL (postgresql://...).");

  const u = new URL(target);
  const lives = [process.env.DATABASE_URL, process.env.DIRECT_URL].filter((v): v is string => !!v);
  if (lives.some((live) => sameDatabase(live, target)) && !allowLive) {
    throw new Error("O destino é o banco em uso (DATABASE_URL/DIRECT_URL). Pare a aplicação e use --allow-live, ou restaure em um banco novo.");
  }

  const bin = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, process.platform === "win32" ? "pg_restore.exe" : "pg_restore") : "pg_restore";
  const args = ["--no-owner", "--no-privileges", "--single-transaction", "--exit-on-error", "--host", u.hostname, "--port", u.port || "5432", "--username", decodeURIComponent(u.username), "--dbname", u.pathname.slice(1)];
  if (force) args.push("--clean", "--if-exists");
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password), ...(u.searchParams.get("sslmode") ? { PGSSLMODE: u.searchParams.get("sslmode") as string } : {}) };
  execFileSync(bin, [...args, file], { env, stdio: "pipe" });
  console.log(JSON.stringify({ ok: true, destino: u.pathname.slice(1), aviso: "Confira com `npm run db:check-overlaps` apontando DATABASE_URL para o destino." }));
}

try {
  main();
} catch (err) {
  // Nunca imprime a URL do destino (tem a senha).
  console.error("RESTAURAÇÃO FALHOU:", err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "[url omitida]") : err);
  process.exit(1);
}
