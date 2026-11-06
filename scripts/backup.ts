 
/**
 * Backup do banco + retenção + verificação do arquivo gerado.
 *
 *   npm run db:backup
 *
 * Variáveis: DATABASE_URL (o banco a salvar), BACKUP_DIR (padrão ./backups),
 *            BACKUP_KEEP_DAILY (padrão 14), BACKUP_KEEP_MONTHLY (padrão 6),
 *            PG_BIN_DIR (pasta com pg_dump/pg_restore, só para PostgreSQL).
 *
 * SQLite:     VACUUM INTO (cópia consistente mesmo com o site em uso) -> .sqlite, depois conferido abrindo o arquivo.
 * PostgreSQL: pg_dump --format=custom -> .dump, depois conferido com pg_restore --list.
 * Agendar uma vez por dia: veja docs/publicacao.md.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { backupFileName, DEFAULT_RETENTION, positiveIntOr, selectBackupsToDelete } from "./lib/backup-retention";

const root = process.cwd();
const url = process.env.DATABASE_URL ?? "";
const dir = path.resolve(root, process.env.BACKUP_DIR ?? "backups");
const retention = {
  keepDaily: positiveIntOr(process.env.BACKUP_KEEP_DAILY, DEFAULT_RETENTION.keepDaily),
  keepMonthly: positiveIntOr(process.env.BACKUP_KEEP_MONTHLY, DEFAULT_RETENTION.keepMonthly),
};

export function sqlitePath(fileUrl: string): string {
  const p = fileUrl.replace(/^file:/, "").split("?")[0];
  return path.isAbsolute(p) ? p : path.resolve(root, "prisma", p);
}

function pgBin(tool: string): string {
  const base = process.env.PG_BIN_DIR;
  return base ? path.join(base, process.platform === "win32" ? `${tool}.exe` : tool) : tool;
}

async function backupSqlite(out: string) {
  const src = sqlitePath(url);
  const db: any = new PrismaClient({ datasourceUrl: "file:" + src });
  try {
    await db.$executeRawUnsafe(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  } finally {
    await db.$disconnect();
  }
  // Verificação: abre o backup, checa a integridade e conta as linhas principais.
  const check: any = new PrismaClient({ datasourceUrl: "file:" + out });
  try {
    const integrity: any[] = await check.$queryRawUnsafe("PRAGMA integrity_check");
    if (integrity[0]?.integrity_check !== "ok") throw new Error("Backup corrompido: " + JSON.stringify(integrity));
    return { users: await check.user.count(), appointments: await check.appointment.count() };
  } finally {
    await check.$disconnect();
  }
}

function backupPostgres(out: string) {
  const u = new URL(url);
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password), ...(u.searchParams.get("sslmode") ? { PGSSLMODE: u.searchParams.get("sslmode") as string } : {}) };
  execFileSync(
    pgBin("pg_dump"),
    ["--format=custom", "--no-owner", "--host", u.hostname, "--port", u.port || "5432", "--username", decodeURIComponent(u.username), "--file", out, u.pathname.slice(1)],
    { env, stdio: "pipe" }
  );
  // Verificação: o arquivo precisa ser legível pelo pg_restore e conter a tabela de reservas.
  const list = execFileSync(pgBin("pg_restore"), ["--list", out], { stdio: "pipe" }).toString();
  if (!list.includes("Appointment")) throw new Error("O backup não contém a tabela Appointment.");
}

async function main() {
  if (!url) throw new Error("DATABASE_URL não definida.");
  // Backups contêm hashes de senha, nomes, celulares e tokens (criptografados): só o dono lê.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const isSqlite = url.startsWith("file:");
  const out = path.join(dir, backupFileName(new Date(), isSqlite ? "sqlite" : "dump"));

  let info: Record<string, unknown>;
  try {
    info = isSqlite ? await backupSqlite(out) : (backupPostgres(out), {});
    fs.chmodSync(out, 0o600);
  } catch (err) {
    // Nunca deixa um arquivo parcial: ele contaria como "o backup do dia" e a retenção poderia apagar o bom.
    fs.rmSync(out, { force: true });
    throw err;
  }
  const size = fs.statSync(out).size;

  // Retenção: só apaga arquivos de backup que seguem o padrão de nome.
  const removed = selectBackupsToDelete(fs.readdirSync(dir), retention);
  for (const f of removed) fs.unlinkSync(path.join(dir, f));

  console.log(JSON.stringify({ ok: true, arquivo: out, bytes: size, ...info, apagadosPorRetencao: removed }, null, 2));
}

main().catch((err) => {
  console.error("BACKUP FALHOU:", err instanceof Error ? err.message : err);
  process.exit(1);
});
