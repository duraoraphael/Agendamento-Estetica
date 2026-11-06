import { processGoogleSyncQueue } from "./google-sync-queue";

/**
 * Temporizador da fila de sincronização para servidores de processo fixo (npm start, VPS, Docker).
 * Iniciado por src/instrumentation.ts quando o servidor sobe — então volta sozinho após qualquer reinício,
 * e retoma o que ficou PENDENTE/ERRO no banco. Desligue com GOOGLE_SYNC_WORKER=off (ex.: quando só o
 * agendador externo /api/cron/google-sync deve rodar). Em hospedagem serverless o processo não é contínuo:
 * use o agendador externo (veja README).
 */
const INTERVAL_MS = 60_000;
const g = globalThis as unknown as { __googleSyncWorker?: ReturnType<typeof setInterval> };

export function startGoogleSyncWorker() {
  if (g.__googleSyncWorker) return; // recarregamento a quente do dev não duplica o temporizador
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await processGoogleSyncQueue({ limit: 10 });
      if (r.picked > 0) console.warn(JSON.stringify({ ts: new Date().toISOString(), kind: "google_sync", ...r }));
    } catch (err) {
      console.error("Fila do Google Agenda:", err instanceof Error ? err.message.slice(0, 200) : "erro");
    } finally {
      running = false;
    }
  };
  g.__googleSyncWorker = setInterval(tick, INTERVAL_MS);
  g.__googleSyncWorker.unref?.();
  setTimeout(tick, 5_000).unref?.(); // varredura logo após o arranque: recupera o que ficou pendente antes do reinício
}
