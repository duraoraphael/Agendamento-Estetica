import { PrismaClient } from "@prisma/client";
import { migrateManicureServices } from "../src/lib/service-migration";

/**
 * Migra os dados de demonstração da manicure para a Garage Zero Zero. Idempotente. Veja src/lib/service-migration.ts.
 *
 *   npm run db:migrate-services -- --dry-run   só mostra o que seria feito
 *   npm run db:migrate-services                aplica
 *
 * Ordem na publicação: `npm run db:deploy` (migrações), depois este script, depois o código novo (README / docs/publicacao.md).
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();
  try {
    const report = await migrateManicureServices(prisma, { dryRun });
    console.log(dryRun ? "SIMULAÇÃO (nada foi gravado):" : "Migração aplicada:");
    console.log(`  Serviços antigos desativados (${report.deactivated.length}): ${report.deactivated.join(", ") || "nenhum"}`);
    console.log(`  Serviços automotivos cadastrados (${report.created.length}): ${report.created.join(", ") || "nenhum (já existiam)"}`);
    console.log(`  Configurações do site restauradas ao padrão novo: ${report.settingsFieldsReset.join(", ") || "nenhuma"}`);
    console.log("Reservas e serviços personalizados não foram alterados.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
