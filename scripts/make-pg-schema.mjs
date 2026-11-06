// Gera prisma/postgres/schema.prisma a partir de prisma/schema.prisma (a única fonte da verdade),
// trocando apenas o provedor. Assim os modelos nunca divergem entre SQLite e PostgreSQL.
//
//   node scripts/make-pg-schema.mjs                 -> prisma/postgres/schema.prisma (cliente padrão; use em produção)
//   node scripts/make-pg-schema.mjs --test          -> prisma/postgres/schema.test.prisma (cliente em .prisma-pg-client; só testes)
//   node scripts/make-pg-schema.mjs --check         -> falha se o schema versionado estiver desatualizado
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

export function derivePgSchema(source, { testClient = false } = {}) {
  let out = source.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
  if (out === source) throw new Error('Não encontrei provider = "sqlite" em prisma/schema.prisma');
  out = out.replace(/\/\/ SQLite local:[^\n]*\n\s*\/\/ concorrência[^\n]*\n/, "");
  if (testClient) {
    out = out.replace(/generator client \{\n/, 'generator client {\n  output   = "../../.prisma-pg-client"\n');
  }
  const header =
    "// ARQUIVO GERADO por scripts/make-pg-schema.mjs a partir de prisma/schema.prisma. NÃO EDITE.\n" +
    "// A restrição de exclusão (sem sobreposição de horários) está na migração SQL desta pasta.\n\n";
  return header + out;
}

const source = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const target = path.join(root, "prisma/postgres", args.has("--test") ? "schema.test.prisma" : "schema.prisma");

if (args.has("--check")) {
  const expected = derivePgSchema(source);
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (expected !== current) {
    console.error("prisma/postgres/schema.prisma está desatualizado. Rode: node scripts/make-pg-schema.mjs");
    process.exit(1);
  }
  console.log("prisma/postgres/schema.prisma está em dia.");
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, derivePgSchema(source, { testClient: args.has("--test") }));
  console.log("Gerado:", path.relative(root, target));
}
