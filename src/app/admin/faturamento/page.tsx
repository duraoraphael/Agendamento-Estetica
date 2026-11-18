import Link from "next/link";
import { getBillingSummary, shiftPeriodKey, type PeriodKind } from "@/lib/billing";
import { formatCents, dateKeyInTz } from "@/lib/format";
import { dateKeyOr } from "@/lib/date-keys";
import { STATUS_LABELS } from "@/lib/constants";
import { ALL_APPOINTMENT_STATUSES } from "@/lib/types";
import { BillingChartLazy } from "@/components/BillingChartLazy";
import { StatusBadge } from "@/components/StatusBadge";

const PERIOD_LABELS: Record<PeriodKind, string> = {
  DIARIO: "Diário",
  SEMANAL: "Semanal",
  MENSAL: "Mensal",
};

export default async function FaturamentoPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ kind?: string; ref?: string }>;
}) {
  // Next 15: searchParams é assíncrono (em Next 14 o await é inofensivo).
  const searchParams = await searchParamsPromise;
  const kind: PeriodKind = (["DIARIO", "SEMANAL", "MENSAL"] as PeriodKind[]).includes(searchParams.kind as PeriodKind)
    ? (searchParams.kind as PeriodKind)
    : "DIARIO";
  // `ref` vem da URL: valida o calendário real e cai no dia de hoje se for inválido.
  const refKey = dateKeyOr(searchParams.ref, dateKeyInTz(new Date()));

  const summary = await getBillingSummary(kind, refKey);
  const prevKey = shiftPeriodKey(kind, refKey, -1);
  const nextKey = shiftPeriodKey(kind, refKey, 1);

  const chartData = kind === "DIARIO" ? summary.revenueByService.map((s) => ({ label: s.name, cents: s.cents })) : summary.chart;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Financeiro</p>
        <h1 className="page-title mt-1">Faturamento</h1>
      </div>

      <nav aria-label="Período do faturamento" className="grid grid-cols-3 gap-1 rounded-full border border-line bg-surface p-1 sm:max-w-md">
        {(["DIARIO", "SEMANAL", "MENSAL"] as PeriodKind[]).map((k) => (
          <Link
            key={k}
            href={`/admin/faturamento?kind=${k}&ref=${dateKeyInTz(new Date())}`}
            aria-current={k === kind ? "page" : undefined}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-full text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              k === kind ? "bg-brand text-ink shadow-soft" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {PERIOD_LABELS[k]}
          </Link>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-3">
        <Link href={`/admin/faturamento?kind=${kind}&ref=${prevKey}`} className="btn-secondary px-4" aria-label="Período anterior">
          ← <span className="hidden sm:inline">Anterior</span>
        </Link>
        <p className="text-center font-display text-lg font-semibold text-fg" aria-live="polite">
          {summary.rangeLabel}
        </p>
        <Link href={`/admin/faturamento?kind=${kind}&ref=${nextKey}`} className="btn-secondary px-4" aria-label="Próximo período">
          <span className="hidden sm:inline">Próximo</span> →
        </Link>
      </div>

      <section aria-label="Totais do período" className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-status-done/25 bg-surface p-6 shadow-soft">
          <p className="flex items-center gap-2 text-sm font-semibold text-status-done">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-status-done" />
            Faturamento dos atendimentos concluídos
          </p>
          <p className="mt-3 font-display text-4xl font-semibold text-fg">{formatCents(summary.concludedCents)}</p>
          <p className="mt-1 text-sm text-fg-muted">
            {summary.concludedCount} atendimento{summary.concludedCount !== 1 ? "s" : ""} concluído{summary.concludedCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="rounded-2xl border border-brand/50 bg-surface p-6 shadow-soft">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-brand" />
            Valor previsto dos agendamentos
          </p>
          <p className="mt-3 font-display text-4xl font-semibold text-brand">{formatCents(summary.predictedCents)}</p>
          <p className="mt-1 text-sm text-fg-muted">
            {summary.predictedCount} agendamento{summary.predictedCount !== 1 ? "s" : ""} confirmado{summary.predictedCount !== 1 ? "s" : ""}
          </p>
        </div>
      </section>

      <section className="card" aria-labelledby="grafico">
        <h2 id="grafico" className="mb-4 font-display text-xl font-semibold text-fg">
          {kind === "DIARIO" ? "Faturamento por serviço" : "Faturamento concluído no período"}
        </h2>
        <BillingChartLazy data={chartData} />
      </section>

      <section className="card" aria-labelledby="situacoes">
        <h2 id="situacoes" className="mb-4 font-display text-xl font-semibold text-fg">
          Atendimentos por situação
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {ALL_APPOINTMENT_STATUSES.map((status) => (
            <li key={status} className="flex flex-col gap-2 rounded-xl bg-ink px-4 py-3">
              <StatusBadge status={status} />
              <span className="font-display text-2xl font-semibold text-fg">
                {summary.countsByStatus[status]}
                <span className="sr-only"> {STATUS_LABELS[status]}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {kind !== "DIARIO" && (
        <section className="card" aria-labelledby="por-servico">
          <h2 id="por-servico" className="mb-4 font-display text-xl font-semibold text-fg">
            Faturamento por serviço
          </h2>
          {summary.revenueByService.length === 0 ? (
            <p className="text-sm text-fg-muted">Nenhum atendimento concluído no período.</p>
          ) : (
            <ul className="divide-y divide-line">
              {summary.revenueByService.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-3 py-3">
                  <span className="text-fg">{s.name}</span>
                  <span className="font-semibold text-brand">{formatCents(s.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
