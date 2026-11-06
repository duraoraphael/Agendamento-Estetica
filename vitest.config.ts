import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Só a suíte SQLite. tests-pg/ roda com `npm run test:pg` (PostgreSQL) e e2e/ com `npm run test:e2e` (Playwright).
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      TOKEN_ENCRYPTION_KEY: "hTIcu8KsnQFn//xNql8gZiD/e6BWkekeGHF696BsgCE=",
      NEXTAUTH_SECRET: "test-secret-não-use-em-producao",
      NEXTAUTH_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_REDIRECT_URI: "",
    },
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
