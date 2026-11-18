import { prisma } from "../src/lib/db";
import { processStorageCleanup } from "../src/lib/service-images";
import { isStorageConfigured } from "../src/lib/storage";

/**
 * Apaga do Storage os arquivos de fotos que ficaram pendentes (a remoção da foto já saiu do banco, mas o Storage estava
 * fora do ar na hora). Seguro para rodar quantas vezes quiser: só toca nos caminhos da tabela StorageCleanup e nunca em
 * um arquivo que ainda tenha foto cadastrada.
 *
 *   npm run storage:cleanup
 */
async function main() {
  try {
    process.loadEnvFile();
  } catch {
    /* sem .env: usa as variáveis do ambiente */
  }
  if (!isStorageConfigured()) {
    console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env e rode de novo.");
    process.exit(1);
  }
  const result = await processStorageCleanup();
  console.log(`Limpeza do Storage: ${result.removed} arquivo(s) apagado(s), ${result.failed} ainda pendente(s).`);
}

main()
  .catch((err) => {
    console.error("Falha na limpeza do Storage:", (err as { name?: string })?.name ?? "Error");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
