import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { PG_TEST_DB, PG_TEST_PASSWORD, PG_TEST_PORT, PG_TEST_URL, PG_TEST_USER } from "./pg-env";

let pg: EmbeddedPostgres | null = null;
let dataDir = "";

export default async function globalSetup() {
  const root = path.resolve(__dirname, "..");
  const run = (cmd: string, env: Record<string, string> = {}) =>
    execSync(cmd, { cwd: root, stdio: "pipe", env: { ...process.env, ...env } });

  // 1) Servidor PostgreSQL real e descartável.
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-pg-"));
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: PG_TEST_USER,
    password: PG_TEST_PASSWORD,
    port: PG_TEST_PORT,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(PG_TEST_DB);

  // 2) Cliente Prisma do PostgreSQL (gerado em .prisma-pg-client) e migrações do PostgreSQL.
  run("node scripts/make-pg-schema.mjs --test");
  run("npx prisma generate --schema prisma/postgres/schema.test.prisma");
  run("npx prisma migrate deploy --schema prisma/postgres/schema.prisma", { DATABASE_URL: PG_TEST_URL });

  return async () => {
    await pg?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
}
