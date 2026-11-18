import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { getNewAppointmentsCount } from "@/lib/admin-stats";
import { localDayRangeUtc, formatCents, dateKeyInTz } from "@/lib/format";
import { AppointmentList, AppointmentRow } from "@/components/AppointmentRow";
import { EmptyState } from "@/components/ui";

export default async function AdminHomePage() {
  const admin = await requireAdmin();

  // Consultas independentes em paralelo (antes eram 4 idas ao banco em sequência).
  const { start, end } = localDayRangeUtc();
  const [today, next, newCount, syncFailures] = await Promise.all([
    prisma.appointment.findMany({
      where: { startAt: { gte: start, lt: end } },
      include: { client: { select: { name: true, phone: true } } },
      orderBy: { startAt: "asc" },
    }),
    prisma.appointment.findMany({
      where: { startAt: { gte: end }, status: "CONFIRMADA" },
      include: { client: { select: { name: true, phone: true } } },
      orderBy: { startAt: "asc" },
      take: 5,
    }),
    getNewAppointmentsCount(admin.id),
    prisma.appointment.count({ where: { googleSyncStatus: "ERRO" } }),
  ]);
  const confirmedToday = today.filter((a) => a.status === "CONFIRMADA" || a.status === "CONCLUIDA");
  const expectedTodayCents = confirmedToday.reduce((sum, a) => sum + a.priceCents, 0);
  const todayKey = dateKeyInTz(new Date());

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Hoje · {todayKey.split("-").reverse().join("/")}</p>
          <h1 className="page-title mt-1">
            Agendamentos de <span className="accent">hoje</span>
          </h1>
          <div className="accent-rule mt-3" aria-hidden="true" />
        </div>
        <Link href="/admin/agendamentos" className="btn-secondary">
          Ver todos os agendamentos
        </Link>
      </div>

      {/* Resumo do dia */}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Agendamentos hoje", value: String(today.length), tone: "text-fg" },
          { label: "Valor previsto", value: formatCents(expectedTodayCents), tone: "text-brand" },
          { label: "Novos agendamentos", value: String(newCount), tone: newCount > 0 ? "text-brand" : "text-fg" },
          { label: "Falhas de sincronização", value: String(syncFailures), tone: syncFailures > 0 ? "text-status-danger" : "text-fg" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-brand/40 bg-surface p-4">
            <dt className="text-xs font-bold uppercase tracking-wide text-fg-muted">{s.label}</dt>
            <dd className={`mt-1 font-display text-3xl font-extrabold ${s.tone}`}>{s.value}</dd>
          </div>
        ))}
      </dl>

      {/* Ações rápidas */}
      <nav aria-label="Ações rápidas" className="flex flex-wrap gap-2">
        <Link href="/admin/agendamentos?view=calendario" className="btn-ghost border border-line">
          Abrir calendário
        </Link>
        <Link href="/admin/servicos" className="btn-ghost border border-line">
          Serviços
        </Link>
        <Link href="/admin/horarios" className="btn-ghost border border-line">
          Horários
        </Link>
        <Link href="/admin/faturamento" className="btn-ghost border border-line">
          Faturamento
        </Link>
      </nav>

      {syncFailures > 0 && (
        <Link
          href="/admin/configuracoes/google"
          className="flex items-center gap-3 rounded-2xl border border-status-danger/30 bg-status-danger-bg px-5 py-3 text-sm font-medium text-status-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span aria-hidden="true">⚠</span>
          {syncFailures} reserva{syncFailures > 1 ? "s" : ""} não {syncFailures > 1 ? "foram sincronizadas" : "foi sincronizada"} com o Google Agenda. Toque para ver e tentar novamente.
        </Link>
      )}

      {newCount > 0 && (
        <Link
          href="/admin/agendamentos"
          className="flex items-center gap-3 rounded-2xl border border-brand/50 bg-surface-2 px-5 py-3 text-sm font-medium text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-brand" />
          Você tem {newCount} novo{newCount > 1 ? "s" : ""} agendamento{newCount > 1 ? "s" : ""}. Toque para ver.
        </Link>
      )}

      <section aria-label="Agendamentos de hoje">
        {today.length === 0 ? (
          <EmptyState title="Nenhum agendamento para hoje">Aproveite o dia livre — novos horários aparecem aqui assim que forem reservados.</EmptyState>
        ) : (
          <AppointmentList label="Agendamentos de hoje">
            {today.map((a) => (
              <AppointmentRow key={a.id} appointment={a} />
            ))}
          </AppointmentList>
        )}
      </section>

      <section aria-labelledby="proximos">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="proximos" className="font-display text-2xl font-semibold text-fg">
            Próximos horários
          </h2>
          <Link href="/admin/agendamentos?view=calendario" className="link text-sm">
            Abrir calendário
          </Link>
        </div>
        {next.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-brand/60 bg-surface/60 px-6 py-6 text-center text-sm text-fg-muted">
            Nenhum horário confirmado para os próximos dias.
          </p>
        ) : (
          <AppointmentList label="Próximos horários">
            {next.map((a) => (
              <AppointmentRow key={a.id} appointment={a} />
            ))}
          </AppointmentList>
        )}
      </section>
    </div>
  );
}
