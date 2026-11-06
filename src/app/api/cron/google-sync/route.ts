import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processGoogleSyncQueue } from "@/lib/google-sync-queue";
import { securityLog } from "@/lib/security-log";

// Gatilho EXTERNO da fila de sincronização com o Google Agenda, para hospedagem sem processo sempre ligado
// (serverless): configure um agendador (Vercel Cron, GitHub Actions, cron-job.org...) para chamar esta rota a
// cada 5 minutos com o cabeçalho  Authorization: Bearer <CRON_SECRET>.  Em servidor fixo (npm start, VPS, Docker)
// o temporizador interno (src/lib/google-sync-worker.ts) já faz isso e este gatilho é opcional.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return false; // sem segredo forte configurado, a rota fica desativada
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(req: Request) {
  if (!authorized(req)) {
    securityLog("cron_unauthorized", {});
    return NextResponse.json({ error: "Não autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const result = await processGoogleSyncQueue({ limit: 25 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
