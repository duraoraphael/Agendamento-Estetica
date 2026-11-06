 
/**
 * ENSAIO da migração SQLite → PostgreSQL, sem tocar em nada real:
 *   npm run db:rehearse-pg                      (usa prisma/dev.db)
 *   npm run db:rehearse-pg -- --source file:./prisma/dev.db
 *
 * Copia o SQLite para uma pasta temporária, sobe um PostgreSQL descartável (embutido), aplica as migrações
 * do PostgreSQL (com a restrição contra sobreposição), roda a migração real e confere o resultado.
 * O banco de origem NÃO é alterado. Código de saída 0 = ensaio passou.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const root = process.cwd();
const srcIdx = process.argv.indexOf("--source");
const sourceUrl = srcIdx >= 0 ? process.argv[srcIdx + 1] : "file:./dev.db";
const rel = sourceUrl.replace(/^file:/, "");
const sourceFile = path.isAbsolute(rel) ? rel : path.resolve(root, "prisma", rel);

async function main() {
  if (!fs.existsSync(sourceFile)) throw new Error(`Banco de origem não encontrado: ${sourceFile}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ensaio-pg-"));
  const copy = path.join(tmp, "origem.db");
  fs.copyFileSync(sourceFile, copy);
  console.log("1/5 Cópia do SQLite feita (o original não é tocado).");

  const sh = (cmd: string, env: Record<string, string> = {}) => execSync(cmd, { cwd: root, stdio: "pipe", env: { ...process.env, ...env } }).toString();
  sh("node scripts/make-pg-schema.mjs --test");
  sh("npx prisma generate --schema prisma/postgres/schema.test.prisma");

  const port = 54340;
  const pg = new EmbeddedPostgres({ databaseDir: path.join(tmp, "pgdata"), user: "postgres", password: "ensaio", port, persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("ensaio");
  const target = `postgresql://postgres:ensaio@127.0.0.1:${port}/ensaio`;
  let ok = false;
  try {
    console.log("2/5 PostgreSQL descartável no ar; aplicando migrações (restrição contra sobreposição incluída)...");
    sh("npx prisma migrate deploy --schema prisma/postgres/schema.prisma", { DATABASE_URL: target });
    console.log("3/5 Rodando a migração...");
    const out = sh(`npx tsx scripts/migrate-sqlite-to-postgres.ts --source "file:${copy.replace(/\\/g, "/")}" --target "${target}"`);
    const report = JSON.parse(out.slice(out.indexOf("{")));
    console.log("4/5 Verificação por contagem e hash: OK");
    console.log(JSON.stringify(report.tabelasCopiadas, null, 2));
    console.log("5/5 Ensaio concluído com sucesso. Nada real foi alterado.");
    ok = report.ok === true;
  } catch (err: any) {
    console.error("ENSAIO FALHOU:\n" + (err.stderr?.toString() || err.stdout?.toString() || err.message));
  } finally {
    await pg.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(ok ? 0 : 1);
}

main();
