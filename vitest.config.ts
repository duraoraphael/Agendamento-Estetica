import { defineConfig } from "vitest/config";
import path from "node:path";
import { PG_TEST_URL } from "./tests/pg-env";

// Os testes rodam contra um PostgreSQL REAL embutido e descartável (veja tests/global-setup.ts), nunca contra o
// Supabase: a DATABASE_URL abaixo sobrepõe a do .env. e2e/ roda com `npm run test:e2e` (Playwright).
export default defineConfig({
  // O tsconfig usa `jsx: preserve` (padrão do Next); aqui o JSX dos componentes testados é compilado com o runtime novo.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL: PG_TEST_URL,
      DIRECT_URL: PG_TEST_URL,
      TOKEN_ENCRYPTION_KEY: "hTIcu8KsnQFn//xNql8gZiD/e6BWkekeGHF696BsgCE=",
      NEXTAUTH_SECRET: "test-secret-não-use-em-producao",
      NEXTAUTH_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_REDIRECT_URI: "",
    },
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
