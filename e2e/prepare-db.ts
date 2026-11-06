import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Banco novo a cada execução: migrações + expediente padrão + serviços + 1 administradora fictícia.
 *
 * Roda ANTES do build e do servidor (veja `webServer.command` em playwright.config.ts). Não pode ficar num
 * `globalSetup`: o Playwright sobe o servidor primeiro e fica consultando /login, que lê as Configurações do banco;
 * sem as tabelas a página responde 500 e a espera estoura o tempo limite.
 */
const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("file:") || !/e2e/.test(url)) throw new Error("Recuso preparar um banco que não seja o descartável de e2e.");

const root = path.resolve(__dirname, "..");
const dbFile = url.slice("file:".length);
for (const ext of ["", "-journal", "-wal", "-shm"]) fs.rmSync(dbFile + ext, { force: true });
// O cache de dados do Next (configurações do site, 5 min) fica em disco dentro da pasta de build e sobreviveria a
// uma execução anterior, mostrando uma logo que o banco novo não tem. Build limpo a cada execução.
if (process.env.NEXT_DIST_DIR) fs.rmSync(path.join(root, process.env.NEXT_DIST_DIR), { recursive: true, force: true });
execSync("npx prisma migrate deploy", { cwd: root, env: process.env, stdio: "pipe" });
execSync("npx tsx prisma/seed.ts", { cwd: root, env: process.env, stdio: "pipe" });
console.log("Banco de e2e pronto.");
