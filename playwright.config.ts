import { defineConfig } from "@playwright/test";

// Testes de tela (navegador real: Microsoft Edge instalado, sem baixar navegadores).
//   npm run test:e2e
// Sobe um build de produção ISOLADO (pasta .next-e2e) com um PostgreSQL embutido e descartável (127.0.0.1:54331, banco
// agenda_e2e; nunca o Supabase) e contas fictícias. Tudo é preparado por e2e/start-e2e.ts.
export const E2E_PORT = 3110;
export const E2E_DATABASE_URL = "postgresql://postgres:e2e-only@127.0.0.1:54331/agenda_e2e";
export const E2E_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  DIRECT_URL: E2E_DATABASE_URL,
  E2E_PORT: String(E2E_PORT),
  NEXT_DIST_DIR: ".next-e2e",
  NEXTAUTH_URL: `http://localhost:${E2E_PORT}`,
  NEXTAUTH_SECRET: "e2e-only-secret-not-for-prod-0123456789",
  TOKEN_ENCRYPTION_KEY: "hTIcu8KsnQFn//xNql8gZiD/e6BWkekeGHF696BsgCE=",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_REDIRECT_URI: "",
  GOOGLE_LOGIN_CLIENT_ID: "client-id-e2e-ficticio",
  GOOGLE_LOGIN_CLIENT_SECRET: "client-secret-e2e-ficticio",
  ADMIN_EMAIL: "admin.e2e@example.com",
  ADMIN_PASSWORD: "E2E-Admin#2026",
  ADMIN_NAME: "Admin E2E",
  // Fotos dos serviços: Supabase Storage FALSO em 127.0.0.1 (e2e/fake-storage.ts, subido por e2e/start-e2e.ts).
  // A chave é inventada e só vale lá.
  SUPABASE_URL: "http://127.0.0.1:54340",
  SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-key-not-real",
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
    // Banco embutido + migrações + seed + build + servidor, num só processo (veja e2e/start-e2e.ts).
    command: "npx tsx e2e/start-e2e.ts",
    url: `http://localhost:${E2E_PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: E2E_ENV,
  },
});
