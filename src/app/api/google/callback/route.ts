import { NextResponse, type NextRequest } from "next/server";
import { getAdminApiUser } from "@/lib/session";
import { handleGoogleOAuthCallback, safeErrorSummary, clearFreeBusyCache } from "@/lib/google-calendar";
import { enqueueUnsyncedFuture, processGoogleSyncQueue } from "@/lib/google-sync-queue";

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
    return NextResponse.redirect(new URL("/admin/configuracoes/google?erro=estado_invalido", req.url));
  }

  try {
    await handleGoogleOAuthCallback(admin.id, code);
  } catch (err) {
    // Nunca registra o objeto de erro inteiro (pode carregar o código de autorização) e nunca ecoa texto cru na URL.
    console.error("Falha ao conectar Google Agenda:", safeErrorSummary(err));
    const res = NextResponse.redirect(new URL("/admin/configuracoes/google?erro=falha_google", req.url));
    res.cookies.delete("google_oauth_state");
    return res;
  }

  // Reservas futuras que já existiam antes da conexão entram na fila e são enviadas agora (idempotente).
  clearFreeBusyCache();
  await enqueueUnsyncedFuture().catch((err) => console.error("Falha ao enfileirar reservas existentes:", safeErrorSummary(err)));
  void processGoogleSyncQueue({ limit: 25 }).catch(() => {});

  const res = NextResponse.redirect(new URL("/admin/configuracoes/google?conectado=1", req.url));
  res.cookies.delete("google_oauth_state");
  return res;
}
