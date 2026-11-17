import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { dateKeyInTz, formatDateTimeBR } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  AUDIT_RESULTS,
  AUDIT_RESULT_LABELS,
  auditActionLabel,
  isAuditResult,
} from "@/lib/audit-types";
import { AUDIT_MAX_RANGE_DAYS, listAuditLogs, parseAuditFilters } from "@/lib/audit-log-read";

// Sempre dinâmica: depende da sessão e dos filtros da URL, e nunca deve ser guardada em cache.
export const dynamic = "force-dynamic";

const TARGET_LABELS: Record<string, string> = {
  Appointment: "Agendamento",
  Service: "Serviço",
  User: "Conta",
  BlockedPeriod: "Bloqueio",
  BusinessHours: "Expediente",
  SiteSettings: "Configurações",
  GoogleCalendarAccount: "Google Agenda",
};

const RESULT_CLASSES: Record<string, string> = {
  SUCESSO: "bg-status-confirmed-bg text-status-confirmed",
  FALHA: "bg-status-cancelled-bg text-status-cancelled",
  BLOQUEADO: "bg-status-noshow-bg text-status-noshow",
};

/** "2026-12-31" -> "31/12/2026" (a chave já é o dia local; não passa por Date para não mudar de dia por fuso). */
function formatDateKey(key: string) {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

export default async function LogsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ aba?: string; de?: string; ate?: string; resultado?: string; usuario?: string; pagina?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  // Além do middleware e do layout do painel: a página confere a sessão e o papel (no banco) por conta própria,
  // e a consulta (listAuditLogs) confere de novo. Quem não é administradora nunca chega ao banco.
  await requireAdmin();

  const todayKey = dateKeyInTz(new Date());
  const filters = parseAuditFilters(searchParams, todayKey);
  const listing = await listAuditLogs({
    category: filters.category,
    fromKey: filters.fromKey,
    toKey: filters.toKey,
    result: filters.result,
    usuario: filters.usuario,
    page: filters.page,
  });

  const qs = (overrides: Record<string, string>) => {
    const params = new URLSearchParams({
      aba: filters.category,
      de: filters.fromKey,
      ate: filters.toKey,
      resultado: filters.result ?? "TODOS",
      ...(filters.usuario ? { usuario: filters.usuario } : {}),
      ...overrides,
    });
    return `/admin/logs?${params.toString()}`;
  };

  const tabLink = (active: boolean) =>
    `inline-flex min-h-[40px] items-center whitespace-nowrap rounded-full px-5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-wine ${
      active ? "bg-wine text-white shadow-soft" : "text-plum-muted hover:bg-blush hover:text-plum"
    }`;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Segurança</p>
        <h1 className="page-title mt-1">Logs</h1>
        <p className="mt-2 max-w-2xl text-sm text-plum-muted">
          Registro do que aconteceu no site, em ordem do mais recente para o mais antigo (horário de Brasília). Os registros são somente
          leitura. Tentativas repetidas de login recusado ou bloqueado aparecem agrupadas em uma linha por hora, com a quantidade.
        </p>
      </div>

      <nav aria-label="Categorias de log" className="overflow-x-auto">
        <ul className="flex w-max gap-1 rounded-full border border-neutral-line bg-white p-1">
          {AUDIT_CATEGORIES.map((c) => (
            <li key={c}>
              <Link href={qs({ aba: c, pagina: "1" })} aria-current={c === filters.category ? "page" : undefined} className={tabLink(c === filters.category)}>
                {AUDIT_CATEGORY_LABELS[c]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form
        method="get"
        aria-label="Filtros"
        className="grid grid-cols-1 gap-4 rounded-2xl border border-neutral-line bg-white p-5 shadow-soft sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.4fr_auto] lg:items-end"
      >
        <input type="hidden" name="aba" value={filters.category} />
        <div>
          <label className="label" htmlFor="log-de">
            De
          </label>
          <input id="log-de" type="date" name="de" defaultValue={filters.fromKey} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="log-ate">
            Até
          </label>
          <input id="log-ate" type="date" name="ate" defaultValue={filters.toKey} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="log-resultado">
            Resultado
          </label>
          <select id="log-resultado" name="resultado" defaultValue={filters.result ?? "TODOS"} className="input">
            <option value="TODOS">Todos</option>
            {AUDIT_RESULTS.map((r) => (
              <option key={r} value={r}>
                {AUDIT_RESULT_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="log-usuario">
            Usuário
          </label>
          <input
            id="log-usuario"
            type="search"
            name="usuario"
            defaultValue={filters.usuario}
            maxLength={100}
            placeholder="Nome ou e-mail completo"
            className="input"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="btn-primary w-full lg:w-auto">
          Filtrar
        </button>
      </form>

      {filters.clamped && (
        <div className="notice-warning" role="status">
          O período foi limitado a {AUDIT_MAX_RANGE_DAYS} dias (de {formatDateKey(filters.fromKey)} a {formatDateKey(filters.toKey)}). Para ver
          datas mais antigas, escolha um novo período.
        </div>
      )}

      {listing.items.length === 0 ? (
        <EmptyState title="Nenhum registro encontrado">
          Não há registros de {AUDIT_CATEGORY_LABELS[filters.category].toLowerCase()} para os filtros escolhidos. O histórico começa na data
          em que este recurso foi ativado: o que aconteceu antes disso não foi registrado.
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-neutral-line bg-white shadow-soft">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">Registros de {AUDIT_CATEGORY_LABELS[filters.category]}</caption>
              <thead className="border-b border-neutral-line bg-neutral-page text-xs uppercase tracking-wide text-plum-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Data e hora</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Ação</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Resultado</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Responsável</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Registro afetado</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-line text-plum">
                {listing.items.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateTimeBR(row.occurredAt)}
                      {row.count > 1 && <span className="block text-xs text-plum-muted">desde {formatDateTimeBR(row.firstAt)}</span>}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {auditActionLabel(row.action)}
                      {row.count > 1 && <span className="ml-2 rounded-full bg-blush px-2 py-0.5 text-xs font-semibold text-wine">{row.count}×</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${RESULT_CLASSES[row.result] ?? "bg-neutral-page text-plum-muted"}`}
                      >
                        {isAuditResult(row.result) ? AUDIT_RESULT_LABELS[row.result] : row.result}
                      </span>
                    </td>
                    <td className="px-4 py-3">{row.actor}</td>
                    <td className="px-4 py-3 text-plum-muted">
                      {row.targetType ? (
                        <>
                          {TARGET_LABELS[row.targetType] ?? row.targetType}
                          {row.targetId && <span className="block font-mono text-xs">{row.targetId.slice(0, 10)}</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-plum-muted">{row.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {listing.pageCount > 1 && (
            <nav aria-label="Paginação" className="flex items-center justify-between gap-3">
              {listing.page > 1 ? (
                <Link href={qs({ pagina: String(listing.page - 1) })} className="btn-secondary px-4" rel="prev">
                  ← Anterior
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
              <p className="text-sm text-plum-muted" aria-live="polite">
                Página {listing.page} de {listing.pageCount} · {listing.total} registros
              </p>
              {listing.page < listing.pageCount ? (
                <Link href={qs({ pagina: String(listing.page + 1) })} className="btn-secondary px-4" rel="next">
                  Próxima →
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
