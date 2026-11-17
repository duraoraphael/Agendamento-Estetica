import { NextResponse, type NextRequest } from "next/server";
import { getAdminApiUser } from "@/lib/session";
import { handleGoogleOAuthCallback, safeErrorSummary, clearFreeBusyCache, GoogleAccountConflictError } from "@/lib/google-calendar";
import { enqueueUnsyncedFuture, processGoogleSyncQueue } from "@/lib/google-sync-queue";
import { recordAudit } from "@/lib/audit-log";

export async function GET(req: NextRequest) {
  const admin = await getAdminApiUser();
  if (!admin) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = req.cookies.get("google_oauth_state")?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    await recordAudit({ action: "google_connect_failed", result: "FALHA", actorId: admin.id, detail: "Verificação de segurança (state) inválida" });
    return NextResponse.redirect(new URL("/admin/configuracoes/google?erro=estado_invalido", req.url));
  }

  try {
    await handleGoogleOAuthCallback(admin.id, code);
  } catch (err) {
    // Nunca registra o objeto de erro inteiro (pode carregar o código de autorização) e nunca ecoa texto cru na URL.
    console.error("Falha ao conectar Google Agenda:", safeErrorSummary(err));
    const reason = err instanceof GoogleAccountConflictError ? "ja_conectado" : "falha_google";
    await recordAudit({
      action: "google_connect_failed",
      result: "FALHA",
      actorId: admin.id,
      detail: reason === "ja_conectado" ? "Já existe outra conta do Google conectada" : "O Google recusou ou falhou na conexão",
    });
    const res = NextResponse.redirect(new URL(`/admin/configuracoes/google?erro=${reason}`, req.url));
    res.cookies.delete("google_oauth_state");
    return res;
  }

  await recordAudit({ action: "google_connected", actorId: admin.id, targetType: "GoogleCalendarAccount" });
  // Reservas futuras que já existiam antes da conexão entram na fila e são enviadas agora (idempotente).
  clearFreeBusyCache();
  await enqueueUnsyncedFuture().catch((err) => console.error("Falha ao enfileirar reservas existentes:", safeErrorSummary(err)));
  void processGoogleSyncQueue({ limit: 25 }).catch(() => {});

  const res = NextResponse.redirect(new URL("/admin/configuracoes/google?conectado=1", req.url));
  res.cookies.delete("google_oauth_state");
  return res;
}
