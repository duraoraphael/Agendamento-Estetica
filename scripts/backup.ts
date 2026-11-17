/**
 * Backup do banco PostgreSQL (Supabase) + retenção + verificação do arquivo gerado.
 *
 *   npm run db:backup
 *
 * Variáveis: DIRECT_URL (preferida) ou DATABASE_URL — o banco a salvar. O pg_dump NÃO funciona pelo
 *            "Transaction pooler" (porta 6543): use a conexão Direct ou o Session pooler (porta 5432) em DIRECT_URL.
 *            BACKUP_DIR (padrão ./backups), BACKUP_KEEP_DAILY (padrão 14), BACKUP_KEEP_MONTHLY (padrão 6),
 *            PG_BIN_DIR (pasta com pg_dump/pg_restore, se não estiverem no PATH).
 *
 * Gera `pg_dump --format=custom` do schema "public" (.dump), depois conferido com `pg_restore --list`.
 * O Supabase também faz seus próprios backups (conforme o plano); este é o seu, fora da plataforma.
 * Agendar uma vez por dia: veja docs/publicacao.md.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { backupFileName, DEFAULT_RETENTION, positiveIntOr, selectBackupsToDelete } from "./lib/backup-retention";

const root = process.cwd();
const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
const dir = path.resolve(root, process.env.BACKUP_DIR ?? "backups");
const retention = {
  keepDaily: positiveIntOr(process.env.BACKUP_KEEP_DAILY, DEFAULT_RETENTION.keepDaily),
  keepMonthly: positiveIntOr(process.env.BACKUP_KEEP_MONTHLY, DEFAULT_RETENTION.keepMonthly),
};

function pgBin(tool: string): string {
  const base = process.env.PG_BIN_DIR;
  return base ? path.join(base, process.platform === "win32" ? `${tool}.exe` : tool) : tool;
}

function backupPostgres(out: string) {
  const u = new URL(url);
  // A senha vai por variável de ambiente (nunca na linha de comando, onde apareceria na lista de processos).
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password), ...(u.searchParams.get("sslmode") ? { PGSSLMODE: u.searchParams.get("sslmode") as string } : {}) };
  execFileSync(
    pgBin("pg_dump"),
    ["--format=custom", "--no-owner", "--no-privileges", "--schema", "public", "--host", u.hostname, "--port", u.port || "5432", "--username", decodeURIComponent(u.username), "--file", out, u.pathname.slice(1)],
    { env, stdio: "pipe" }
  );
  // Verificação: o arquivo precisa ser legível pelo pg_restore e conter a tabela de reservas.
  const list = execFileSync(pgBin("pg_restore"), ["--list", out], { stdio: "pipe" }).toString();
  if (!list.includes("Appointment")) throw new Error("O backup não contém a tabela Appointment.");
}

function main() {
  if (!url) throw new Error("DIRECT_URL/DATABASE_URL não definida.");
  if (!/^postgres(ql)?:/.test(url)) throw new Error("A URL do banco precisa ser PostgreSQL (postgresql://...).");
  // Backups contêm hashes de senha, nomes, celulares e tokens (criptografados): só o dono lê.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const out = path.join(dir, backupFileName(new Date(), "dump"));

  try {
    backupPostgres(out);
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

  console.log(JSON.stringify({ ok: true, arquivo: out, bytes: size, apagadosPorRetencao: removed }, null, 2));
}

try {
  main();
} catch (err) {
  // A mensagem do pg_dump pode citar o host; nunca imprime a URL (tem a senha).
  console.error("BACKUP FALHOU:", err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "[url omitida]") : err);
  process.exit(1);
}
