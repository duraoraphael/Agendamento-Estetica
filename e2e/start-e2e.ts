import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { startFakeStorage } from "./fake-storage";

/**
 * Sobe TUDO o que os testes de tela precisam, num único processo que o Playwright encerra no fim:
 *   1. um PostgreSQL embutido e DESCARTÁVEL (127.0.0.1, banco "agenda_e2e") — nunca o Supabase;
 *   2. as migrações de prisma/migrations + expediente padrão, serviços e 1 administradora fictícia (seed);
 *   3. o build de produção isolado (pasta .next-e2e) e `next start`.
 *
 * Roda ANTES de qualquer teste (veja `webServer.command` em playwright.config.ts): /login lê as Configurações do
 * banco e responderia 500 sem as tabelas, então o banco precisa estar pronto antes de o servidor subir.
 */
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalida");
if (url.hostname !== "127.0.0.1" || !/e2e/.test(url.pathname)) {
  throw new Error("Recuso preparar um banco que não seja o PostgreSQL local e descartável de e2e (127.0.0.1, banco *e2e*).");
}
const port = Number(process.env.E2E_PORT ?? 3110);
const root = path.resolve(__dirname, "..");

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-e2e-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port: Number(url.port),
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  // Supabase Storage falso (127.0.0.1): as fotos dos serviços vão para a memória deste processo, nunca para a rede.
  const storage = await startFakeStorage();
  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    storage.close();
    await pg.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(url.pathname.slice(1));

  try {
    // O cache de dados do Next (configurações do site, 5 min) fica em disco dentro da pasta de build e sobreviveria a
    // uma execução anterior. Build limpo a cada execução.
    if (process.env.NEXT_DIST_DIR) fs.rmSync(path.join(root, process.env.NEXT_DIST_DIR), { recursive: true, force: true });
    execSync("npx prisma migrate deploy", { cwd: root, env: process.env, stdio: "pipe" });
    execSync("npx tsx prisma/seed.ts", { cwd: root, env: process.env, stdio: "pipe" });
    console.log("Banco de e2e pronto.");
    execSync("npx next build", { cwd: root, env: process.env, stdio: "inherit" });
  } catch (err) {
    await cleanup();
    throw err;
  }

  const next = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  const shutdown = async () => {
    next.kill();
    await cleanup();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  next.on("exit", async (code) => {
    await cleanup();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
