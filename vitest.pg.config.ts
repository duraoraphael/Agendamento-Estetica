import { defineConfig } from "vitest/config";
import path from "node:path";
import { PG_TEST_URL } from "./tests-pg/pg-env";

// Roda a suíte contra um PostgreSQL REAL (servidor embutido, sem Docker). Veja `npm run test:pg`.
// O cliente Prisma do PostgreSQL é gerado em .prisma-pg-client e substitui "@prisma/client" só aqui,
// então o cliente SQLite do dia a dia não é tocado.
export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests-pg/global-setup.ts"],
    include: ["tests/**/*.test.ts", "tests-pg/**/*.test.ts"],
    // Específicos de SQLite: backup/restauração por arquivo e dados inválidos que o PostgreSQL recusa por restrição.
    exclude: ["tests/backup.test.ts", "tests/ops-security.test.ts", "node_modules/**"],
    env: {
      DATABASE_URL: PG_TEST_URL,
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
    alias: [
      { find: /^@prisma\/client$/, replacement: path.resolve(__dirname, ".prisma-pg-client/index.js") },
      { find: /^@\//, replacement: path.resolve(__dirname, "src") + "/" },
    ],
  },
});
