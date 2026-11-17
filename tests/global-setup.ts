import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { PG_TEST_DB, PG_TEST_PASSWORD, PG_TEST_PORT, PG_TEST_URL, PG_TEST_USER } from "./pg-env";

let pg: EmbeddedPostgres | null = null;
let dataDir = "";

/**
 * Os testes rodam num PostgreSQL REAL e DESCARTÁVEL (servidor embutido, sem Docker), com as mesmas migrações
 * que vão para o Supabase. Nunca tocam no banco do .env: a URL é fixa, local, e vem de tests/pg-env.ts.
 */
export default async function globalSetup() {
  const root = path.resolve(__dirname, "..");

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

  // Migrações de prisma/migrations (tabelas, restrição contra sobreposição, CHECKs e RLS).
  execSync("npx prisma migrate deploy", {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: PG_TEST_URL, DIRECT_URL: PG_TEST_URL },
  });

  return async () => {
    await pg?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
}
