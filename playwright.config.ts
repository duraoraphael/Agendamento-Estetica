import path from "node:path";
import { defineConfig } from "@playwright/test";

// Testes de tela (navegador real: Microsoft Edge instalado, sem baixar navegadores).
//   npm run test:e2e
// Sobe um build de produção ISOLADO (pasta .next-e2e) com um banco próprio (prisma/e2e.db), contas fictícias.
export const E2E_PORT = 3110;
export const E2E_DB = path.resolve(__dirname, "prisma", "e2e.db").replace(/\\/g, "/");
export const E2E_ENV = {
  DATABASE_URL: `file:${E2E_DB}`,
  NEXT_DIST_DIR: ".next-e2e",
  NEXTAUTH_URL: `http://localhost:${E2E_PORT}`,
  NEXTAUTH_SECRET: "e2e-only-secret-not-for-prod-0123456789",
  TOKEN_ENCRYPTION_KEY: "hTIcu8KsnQFn//xNql8gZiD/e6BWkekeGHF696BsgCE=",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_REDIRECT_URI: "",
  ADMIN_EMAIL: "admin.e2e@example.com",
  ADMIN_PASSWORD: "E2E-Admin#2026",
  ADMIN_NAME: "Admin E2E",
};
Object.assign(process.env, E2E_ENV);

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${E2E_PORT}`, channel: "msedge", trace: "off", locale: "pt-BR", timezoneId: "America/Sao_Paulo" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "celular-390", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    // O banco é preparado antes do servidor: /login lê as Configurações do banco e responderia 500 sem as tabelas.
    command: "npx tsx e2e/prepare-db.ts && npx next build && npx next start -p " + E2E_PORT,
    url: `http://localhost:${E2E_PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: E2E_ENV,
  },
});
