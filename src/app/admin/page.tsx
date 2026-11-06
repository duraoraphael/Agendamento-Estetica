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
          <h1 className="page-title mt-1">Agendamentos de hoje</h1>
          <p className="mt-1 text-sm text-plum-muted">
            {today.length} agendamento{today.length !== 1 ? "s" : ""} · previsto hoje {formatCents(expectedTodayCents)}
          </p>
        </div>
        <Link href="/admin/agendamentos" className="btn-secondary">
          Ver todos os agendamentos
        </Link>
      </div>

      {syncFailures > 0 && (
        <Link
          href="/admin/configuracoes/google"
          className="flex items-center gap-3 rounded-2xl border border-status-danger/30 bg-status-danger-bg px-5 py-3 text-sm font-medium text-status-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-wine"
        >
          <span aria-hidden="true">⚠</span>
          {syncFailures} reserva{syncFailures > 1 ? "s" : ""} não {syncFailures > 1 ? "foram sincronizadas" : "foi sincronizada"} com o Google Agenda. Toque para ver e tentar novamente.
        </Link>
      )}

      {newCount > 0 && (
        <Link
          href="/admin/agendamentos"
          className="flex items-center gap-3 rounded-2xl border border-gold/50 bg-blush px-5 py-3 text-sm font-medium text-wine focus:outline-none focus-visible:ring-2 focus-visible:ring-wine"
        >
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-wine" />
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
          <h2 id="proximos" className="font-display text-2xl font-semibold text-plum">
            Próximos horários
          </h2>
          <Link href="/admin/agendamentos?view=calendario" className="link text-sm">
            Abrir calendário
          </Link>
        </div>
        {next.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gold/60 bg-white/60 px-6 py-6 text-center text-sm text-plum-muted">
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
