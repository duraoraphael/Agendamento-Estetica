import Link from "next/link";
import { prisma } from "@/lib/db";
import { zonedToUtc, dateKeyInTz } from "@/lib/format";
import { AppointmentList, AppointmentRow } from "@/components/AppointmentRow";
import { EmptyState } from "@/components/ui";
import { getMonthGrid, shiftMonthKey } from "@/lib/calendar-grid";
import { ALL_APPOINTMENT_STATUSES, type AppointmentStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/constants";
import { monthKeyOr } from "@/lib/date-keys";
import { ADMIN_LIST_MAX_RANGE_DAYS, listAppointmentsPage, parsePageNumber, resolveDateRange } from "@/lib/admin-appointments";
import { requireAdmin } from "@/lib/session";
import { getNewAppointmentsCount } from "@/lib/admin-stats";
import { MarkNotificationsSeen } from "@/components/MarkNotificationsSeen";

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function monthTitle(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

function dayLabel(key: string, count: number) {
  const [y, m, d] = key.split("-").map(Number);
  const base = `${d} de ${MONTH_NAMES[m - 1]} de ${y}`;
  return count > 0 ? `${base}, ${count} agendamento${count > 1 ? "s" : ""}` : `${base}, sem agendamentos`;
}

/** "2026-12-31" -> "31/12/2026" (a chave já é o dia local; não passa por Date para não mudar de dia por fuso). */
function formatDateKey(key: string) {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

function parseKeyToUtcStart(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return zonedToUtc(y, m, d, 0, 0);
}

export default async function AgendamentosPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string; view?: string; month?: string; page?: string }>;
}) {
  // Next 15: searchParams é assíncrono (em Next 14 o await é inofensivo).
  const searchParams = await searchParamsPromise;
  // Leitura apenas: marcar como visto é uma mutação autenticada disparada pelo navegador (MarkNotificationsSeen).
  const admin = await requireAdmin();

  const todayKey = dateKeyInTz(new Date());
  const view = searchParams.view === "calendario" ? "calendario" : "lista";
  // Filtros vindos da URL são validados antes de virar data ou consulta; inválidos caem no padrão.
  const status = ALL_APPOINTMENT_STATUSES.includes(searchParams.status as AppointmentStatus) ? (searchParams.status as AppointmentStatus) : undefined;
  const monthKey = monthKeyOr(searchParams.month, todayKey.slice(0, 7));

  // Datas validadas no servidor, com intervalo máximo mesmo para valores digitados na URL (src/lib/admin-appointments.ts).
  const { fromKey, toKey, clamped } = resolveDateRange(searchParams.from, searchParams.to, todayKey);
  const requestedPage = parsePageNumber(searchParams.page);

  const monthStart = parseKeyToUtcStart(`${monthKey}-01`);
  const monthEnd = new Date(parseKeyToUtcStart(shiftMonthKey(monthKey, 1) + "-01").getTime());

  // Consultas independentes em paralelo. A lista só é buscada na visão "lista" (no calendário ela não é exibida).
  const [newCount, listing, monthAppointments] = await Promise.all([
    getNewAppointmentsCount(admin.id),
    view === "lista" ? listAppointmentsPage({ fromKey, toKey, status, page: requestedPage }) : Promise.resolve(null),
    view === "calendario"
      ? prisma.appointment.findMany({ where: { startAt: { gte: monthStart, lt: monthEnd } }, select: { startAt: true } })
      : Promise.resolve([] as { startAt: Date }[]),
  ]);
  const appointments = listing?.items ?? [];
  const hasNew = newCount > 0;

  const countsByDay = new Map<string, number>();
  for (const a of monthAppointments) {
    const key = dateKeyInTz(a.startAt);
    countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
  }

  const qs = (overrides: Record<string, string>) => {
    const params = new URLSearchParams({
      from: fromKey,
      to: toKey,
      status: status ?? "TODAS",
      view,
      month: monthKey,
      ...overrides,
    });
    return `/admin/agendamentos?${params.toString()}`;
  };

  const viewLink = (active: boolean) =>
    `inline-flex min-h-[40px] items-center rounded-full px-5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-wine ${
      active ? "bg-wine text-white shadow-soft" : "text-plum-muted hover:bg-blush hover:text-plum"
    }`;

  return (
    <div className="space-y-6">
      <MarkNotificationsSeen hasNew={hasNew} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Agenda</p>
          <h1 className="page-title mt-1">Agendamentos</h1>
        </div>
        <nav aria-label="Modo de visualização" className="flex gap-1 rounded-full border border-neutral-line bg-white p-1">
          <Link href={qs({ view: "lista" })} aria-current={view === "lista" ? "page" : undefined} className={viewLink(view === "lista")}>
            Lista
          </Link>
          <Link href={qs({ view: "calendario" })} aria-current={view === "calendario" ? "page" : undefined} className={viewLink(view === "calendario")}>
            Calendário
          </Link>
        </nav>
      </div>

      <form
        method="get"
        aria-label="Filtros"
        className="grid grid-cols-1 gap-4 rounded-2xl border border-neutral-line bg-white p-5 shadow-soft sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end"
      >
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="month" value={monthKey} />
        <div>
          <label className="label" htmlFor="filter-from">
            De
          </label>
          <input id="filter-from" type="date" name="from" defaultValue={fromKey} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="filter-to">
            Até
          </label>
          <input id="filter-to" type="date" name="to" defaultValue={toKey} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="filter-status">
            Situação
          </label>
          <select id="filter-status" name="status" defaultValue={status ?? "TODAS"} className="input">
            <option value="TODAS">Todas</option>
            {ALL_APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary w-full lg:w-auto">
          Filtrar
        </button>
      </form>

      {clamped && (
        <div className="notice-warning" role="status">
          O período foi limitado a {ADMIN_LIST_MAX_RANGE_DAYS} dias (de {formatDateKey(fromKey)} a {formatDateKey(toKey)}). Para ver
          datas mais adiante, escolha um novo período.
        </div>
      )}

      {view === "calendario" ? (
        <section aria-label="Calendário de agendamentos" className="mx-auto max-w-2xl rounded-2xl border border-neutral-line bg-white p-4 shadow-soft sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <Link href={qs({ month: shiftMonthKey(monthKey, -1) })} className="btn-secondary px-4" aria-label="Mês anterior">
              ←
            </Link>
            <h2 className="font-display text-xl font-semibold capitalize text-plum" aria-live="polite">
              {monthTitle(monthKey)}
            </h2>
            <Link href={qs({ month: shiftMonthKey(monthKey, 1) })} className="btn-secondary px-4" aria-label="Próximo mês">
              →
            </Link>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-plum-muted" aria-hidden="true">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
              <div key={i} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="mt-1 space-y-1">
            {getMonthGrid(monthKey).map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((cell) => {
                  const count = countsByDay.get(cell.dateKey) ?? 0;
                  const isToday = cell.dateKey === todayKey;
                  return (
                    <Link
                      key={cell.dateKey}
                      href={qs({ view: "lista", from: cell.dateKey, to: cell.dateKey })}
                      aria-label={dayLabel(cell.dateKey, count)}
                      aria-current={isToday ? "date" : undefined}
                      className={`flex aspect-square min-h-[44px] flex-col items-center justify-center rounded-xl text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-wine ${
                        cell.inMonth ? "text-plum hover:bg-blush" : "text-plum-muted/70 hover:bg-neutral-page"
                      } ${isToday ? "bg-blush font-bold ring-2 ring-wine" : count > 0 ? "bg-blush-light" : ""}`}
                    >
                      <span>{Number(cell.dateKey.slice(-2))}</span>
                      {count > 0 && (
                        <span className="mt-0.5 min-w-[1.25rem] rounded-full bg-wine px-1.5 text-[11px] font-bold leading-5 text-white">{count}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-plum-muted">
            O número em vinho indica a quantidade de agendamentos no dia. Toque em um dia para ver a lista.
          </p>
        </section>
      ) : appointments.length === 0 ? (
        <EmptyState title="Nenhum agendamento encontrado">
          Não há agendamentos para o período e a situação escolhidos. Ajuste os filtros acima.
        </EmptyState>
      ) : (
        <>
          <AppointmentList label="Agendamentos">
            {appointments.map((a) => (
              <AppointmentRow key={a.id} appointment={a} />
            ))}
          </AppointmentList>
          {listing && listing.pageCount > 1 && (
            <nav aria-label="Paginação" className="flex items-center justify-between gap-3">
              {listing.page > 1 ? (
                <Link href={qs({ page: String(listing.page - 1) })} className="btn-secondary px-4" rel="prev">
                  ← Anterior
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
              <p className="text-sm text-plum-muted" aria-live="polite">
                Página {listing.page} de {listing.pageCount} · {listing.total} agendamentos
              </p>
              {listing.page < listing.pageCount ? (
                <Link href={qs({ page: String(listing.page + 1) })} className="btn-secondary px-4" rel="next">
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
