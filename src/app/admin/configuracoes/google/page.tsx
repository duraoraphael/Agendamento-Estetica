import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { isGoogleConfigured } from "@/lib/google-calendar";
import { formatDateTimeBR } from "@/lib/format";
import { getSyncOverview } from "@/lib/google-sync-queue";
import { isMockCalendarEnabled } from "@/lib/google-mock";
import { retrySyncAction } from "@/app/admin/agendamentos/actions";
import { disconnectGoogleAction, retryAllFailedAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  nao_configurado:
    "A integração com o Google Agenda ainda não foi configurada neste servidor. Veja o README para criar as credenciais.",
  estado_invalido: "Não foi possível confirmar a conexão (sessão expirada). Tente novamente.",
  falha_google:
    "O Google não concluiu a conexão. Se já autorizou antes, remova o acesso do app em myaccount.google.com/permissions e tente de novo.",
};

export default async function GoogleConfigPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ conectado?: string; erro?: string }>;
}) {
  // Next 15: searchParams é assíncrono (em Next 14 o await é inofensivo).
  const searchParams = await searchParamsPromise;
  const admin = await requireAdmin();
  const configured = isGoogleConfigured();
  const [account, overview] = await Promise.all([
    prisma.googleCalendarAccount.findUnique({ where: { adminUserId: admin.id } }),
    getSyncOverview(),
  ]);
  const mock = isMockCalendarEnabled();

  const errorMessage = searchParams.erro ? ERROR_MESSAGES[searchParams.erro] ?? "Não foi possível conectar ao Google Agenda." : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold text-plum sm:text-3xl">Google Agenda</h1>
        <p className="text-sm text-plum-muted">
          Conecte sua conta do Google para sincronizar automaticamente os agendamentos confirmados como eventos na
          sua agenda. A agenda interna do site continua funcionando mesmo sem essa conexão.
        </p>
      </div>

      {searchParams.conectado && (
        <div className="notice-success" role="status">Google Agenda conectado com sucesso!</div>
      )}
      {errorMessage && <div className="notice-error" role="alert">{errorMessage}</div>}

      {mock && (
        <div className="notice-warning" role="status">
          Modo de SIMULAÇÃO ativo (GOOGLE_CALENDAR_MOCK=1): nenhum evento real é criado no Google. Use só em desenvolvimento.
        </div>
      )}

      {!configured && !mock ? (
        <div className="card text-sm text-plum-muted">
          <p className="font-semibold text-plum">Integração ainda não configurada</p>
          <p className="mt-1">
            Defina <code className="rounded bg-neutral-page px-1">GOOGLE_CLIENT_ID</code>,{" "}
            <code className="rounded bg-neutral-page px-1">GOOGLE_CLIENT_SECRET</code> e{" "}
            <code className="rounded bg-neutral-page px-1">GOOGLE_REDIRECT_URI</code> no arquivo <code>.env</code> do
            servidor. O passo a passo completo (criação do projeto no Google Cloud, tela de consentimento e
            credenciais OAuth) está no README, na seção &ldquo;Conectar o Google Agenda&rdquo;.
          </p>
        </div>
      ) : account ? (
        <div className="card space-y-3">
          <p className="text-sm text-plum-muted">
            Conectado em <strong>{formatDateTimeBR(account.connectedAt)}</strong>.
          </p>
          {account.lastSyncError && (
            <p className="text-sm text-status-danger">Último erro de sincronização: {account.lastSyncError}</p>
          )}
          <form action={disconnectGoogleAction}>
            <button type="submit" className="btn-danger w-full">
              Desconectar Google Agenda
            </button>
          </form>
        </div>
      ) : mock ? (
        <div className="card text-sm text-plum-muted">Conexão simulada: conecte uma conta de teste no banco para exercitar a sincronização.</div>
      ) : (
        <a href="/api/google/connect" className="btn-primary block w-full text-center">
          Conectar Google Agenda
        </a>
      )}
      {account && (
        <section className="card space-y-3" aria-labelledby="sincronizacao">
          <h2 id="sincronizacao" className="font-display text-xl font-semibold text-plum">
            Sincronização das reservas
          </h2>
          <p className="text-sm text-plum-muted">
            Cada reserva confirmada vira um evento na sua agenda; alterações e cancelamentos são refletidos. Se o Google estiver fora do ar, as
            tentativas continuam sozinhas (1 min, 5 min, 15 min, 1 h e 6 h) e sobrevivem a reinícios do servidor.
          </p>
          <p className="text-sm text-plum">
            Aguardando envio: <strong>{overview.pending}</strong> · Com falha: <strong>{overview.failed.length}</strong>
          </p>
          {overview.failed.length === 0 ? (
            <p className="text-sm text-status-done">✓ Nenhuma falha de sincronização.</p>
          ) : (
            <>
              <ul className="divide-y divide-neutral-line rounded-xl border border-status-danger/30 bg-status-danger-bg">
                {overview.failed.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block font-semibold text-plum">
                        {a.serviceName} — {a.client.name}
                      </span>
                      <span className="block text-plum-muted">
                        {formatDateTimeBR(a.startAt)} · {a.googleSyncAttempts} tentativa{a.googleSyncAttempts === 1 ? "" : "s"}
                        {a.googleSyncNextAt ? ` · próxima automática: ${formatDateTimeBR(a.googleSyncNextAt)}` : " · tentativas automáticas esgotadas"}
                      </span>
                      {a.googleSyncError && <span className="block text-xs text-status-danger">{a.googleSyncError}</span>}
                    </span>
                    <form action={retrySyncAction.bind(null, a.id)}>
                      <button type="submit" className="btn-secondary">
                        Tentar novamente
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={retryAllFailedAction}>
                <button type="submit" className="btn-primary w-full sm:w-auto">
                  Tentar novamente todas
                </button>
              </form>
            </>
          )}
        </section>
      )}
    </div>
  );
}
