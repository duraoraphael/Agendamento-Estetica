import { ensureServiceImageBucket, isStorageConfigured, StorageError } from "../src/lib/storage";
import { SERVICE_IMAGE_BUCKET } from "../src/lib/service-image-config";

/**
 * Cria o bucket público `service-images` no Supabase Storage (idempotente: se já existe, só confirma).
 *
 *   npm run storage:setup
 *
 * Precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env (a chave fica só no servidor; nunca NEXT_PUBLIC_*).
 * O bucket é público só para LEITURA e aceita apenas WebP de até 8 MB. Nenhuma política de escrita é criada: o
 * navegador não consegue enviar nem apagar; só o servidor (depois do NextAuth) escreve. Veja docs/fotos-servicos.md.
 */
async function main() {
  try {
    process.loadEnvFile(); // Node 20.12+: lê o .env da pasta atual (sem imprimir nada)
  } catch {
    /* sem .env: usa as variáveis do ambiente */
  }
  if (!isStorageConfigured()) {
    console.error("Defina SUPABASE_URL (https://<projeto>.supabase.co) e SUPABASE_SERVICE_ROLE_KEY no .env e rode de novo.");
    process.exit(1);
  }
  const result = await ensureServiceImageBucket();
  console.log(result === "created" ? `Bucket "${SERVICE_IMAGE_BUCKET}" criado (público para leitura).` : `Bucket "${SERVICE_IMAGE_BUCKET}" já existe.`);
}

main().catch((err) => {
  // Nunca imprime a resposta do Supabase nem a chave.
  console.error(err instanceof StorageError ? "Não foi possível falar com o Supabase Storage (confira SUPABASE_URL e a chave)." : "Falha inesperada ao criar o bucket.");
  process.exit(1);
});
