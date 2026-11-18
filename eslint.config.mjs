import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  {
    // Ferramentas locais e o repositório externo ECC não fazem parte da aplicação nem do artefato publicado.
    ignores: [
      ".next/**",
      ".next-*/**",
      ".prisma-pg-client/**",
      "node_modules/**",
      "prisma/**",
      ".agents/**",
      ".aider-desk/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".skills/**",
      ".vscode/**",
      ".github/**",
      "ECC/**",
      "e2e/screenshots/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Testes e scripts de manutenção lidam com clientes Prisma de dois bancos e dublês: `any`/`require` são aceitáveis aqui.
    files: ["tests/**", "tests-pg/**", "e2e/**", "scripts/**", "*.config.ts", "*.config.mjs"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-require-imports": "off", "import/no-anonymous-default-export": "off" },
  },
];
