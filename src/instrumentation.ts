/**
 * Roda uma vez quando o servidor Next.js inicia.
 *  1. Inicia o trabalhador da fila do Google Agenda (servidor de processo fixo).
 *  2. Em produção, recusa subir com segredos fracos ou de exemplo.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  // Durante `next build` o banco e as variáveis podem não existir; o servidor (`next start`) é que precisa delas.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // O teste literal de NEXT_RUNTIME === "nodejs" é o que faz o empacotador remover este trecho (e o SDK do Google,
  // que usa módulos do Node) do pacote do runtime "edge".
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.GOOGLE_SYNC_WORKER !== "off" && process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    // Sem await: o arranque do servidor não espera por isso, e a checagem de segredos abaixo continua síncrona.
    void import("./lib/google-sync-worker").then((m) => m.startGoogleSyncWorker());
  }

  if (process.env.NODE_ENV !== "production") return;

  const secret = process.env.NEXTAUTH_SECRET ?? "";
  const placeholder = /coloque|defina|exemplo|changeme|secret$/i;
  if (secret.length < 32 || placeholder.test(secret)) {
    throw new Error(
      "NEXTAUTH_SECRET ausente, curto (< 32 caracteres) ou de exemplo. Gere um novo com `openssl rand -base64 32`."
    );
  }
}
