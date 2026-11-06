/**
 * Restaura um backup em um banco de DESTINO. Pensado para restaurar em um banco NOVO e conferir antes de
 * apontar a aplicação para ele.
 *
 *   npx tsx scripts/restore.ts <arquivo-de-backup> --target file:C:/caminho/restaurado.db [--force]
 *   npx tsx scripts/restore.ts <arquivo-de-backup> --target "postgresql://..." [--force]
 *
 * Proteções:
 *  - Recusa sobrescrever o banco em uso (o apontado por DATABASE_URL) sem --allow-live. Pare a aplicação antes.
 *  - Recusa sobrescrever um destino que já existe sem --force.
 *  - SQLite: copia para um arquivo temporário, confere a integridade e só então substitui o destino
 *    (um backup corrompido nunca destrói um destino bom).
 *  - PostgreSQL: pg_restore em uma única transação e parando no primeiro erro (nada fica pela metade).
 *    Requer PG_BIN_DIR ou pg_restore no PATH.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = process.cwd();

function sqliteFile(url: string): string {
  const p = url.replace(/^file:/, "").split("?")[0];
  return path.resolve(path.isAbsolute(p) ? p : path.resolve(root, "prisma", p));
}

async function main() {
  const file = process.argv[2];
  const target = arg("target");
  const force = process.argv.includes("--force");
  const allowLive = process.argv.includes("--allow-live");
  if (!file || !target || file.startsWith("--")) {
    console.error("Uso: restore.ts <arquivo> --target <url-do-destino> [--force] [--allow-live]");
    process.exit(64);
  }
  if (!fs.existsSync(file)) throw new Error(`Arquivo de backup não encontrado: ${file}`);
  const live = process.env.DATABASE_URL ?? "";

  if (target.startsWith("file:")) {
    const dest = sqliteFile(target);
    if (live.startsWith("file:") && sqliteFile(live) === dest && !allowLive) {
      throw new Error("O destino é o banco em uso (DATABASE_URL). Pare a aplicação e use --allow-live, ou restaure em outro arquivo.");
    }
    if (fs.existsSync(dest) && !force) throw new Error(`O destino já existe (${dest}). Use --force para sobrescrever.`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    // 1) copia para um temporário e confere ANTES de tocar no destino
    const tmp = dest + ".restoring";
    fs.copyFileSync(file, tmp);
    const db = new PrismaClient({ datasourceUrl: "file:" + tmp });
    let counts: { users: number; appointments: number };
    try {
      const integrity = await db.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check");
      if (integrity[0]?.integrity_check !== "ok") throw new Error("O backup falhou na checagem de integridade; o destino não foi alterado.");
      counts = { users: await db.user.count(), appointments: await db.appointment.count() };
    } catch (err) {
      await db.$disconnect();
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    await db.$disconnect();

    // 2) só agora substitui o destino (e remove arquivos auxiliares do banco antigo)
    for (const ext of ["-journal", "-wal", "-shm"]) fs.rmSync(dest + ext, { force: true });
    fs.renameSync(tmp, dest);
    console.log(JSON.stringify({ ok: true, destino: dest, ...counts }, null, 2));
    return;
  }

  const u = new URL(target);
  const sameAsLive = (() => {
    try {
      const l = new URL(live);
      return l.hostname === u.hostname && (l.port || "5432") === (u.port || "5432") && l.pathname === u.pathname;
    } catch {
      return false;
    }
  })();
  if (sameAsLive && !allowLive) {
    throw new Error("O destino é o banco em uso (DATABASE_URL). Pare a aplicação e use --allow-live, ou restaure em um banco novo.");
  }
  const bin = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, process.platform === "win32" ? "pg_restore.exe" : "pg_restore") : "pg_restore";
  const args = ["--no-owner", "--single-transaction", "--exit-on-error", "--host", u.hostname, "--port", u.port || "5432", "--username", decodeURIComponent(u.username), "--dbname", u.pathname.slice(1)];
  if (force) args.push("--clean", "--if-exists");
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password), ...(u.searchParams.get("sslmode") ? { PGSSLMODE: u.searchParams.get("sslmode") as string } : {}) };
  execFileSync(bin, [...args, file], { env, stdio: "pipe" });
  console.log(JSON.stringify({ ok: true, destino: u.pathname.slice(1), aviso: "Confira com `npm run db:check-overlaps` apontando DATABASE_URL para o destino." }));
}

main().catch((err) => {
  console.error("RESTAURAÇÃO FALHOU:", err instanceof Error ? err.message : err);
  process.exit(1);
});
