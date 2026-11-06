import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireClient } from "@/lib/session";
import { splitUpcomingAndHistory } from "@/lib/appointments";
import { formatCents, formatDateBR, formatTimeBR } from "@/lib/format";
import { TIMEZONE } from "@/lib/constants";
import { cancelPolicyText, getBookingPolicy } from "@/lib/policy";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState, Notice, Page } from "@/components/ui";
import { AddToGoogleCalendar } from "@/components/AddToGoogleCalendar";
import { getSiteSettings } from "@/lib/site-settings-cache";

type Item = Awaited<ReturnType<typeof prisma.appointment.findMany>>[number];

function AppointmentCard({ a, muted }: { a: Item; muted?: boolean }) {
  return (
    <li>
      <Link href={`/meus-agendamentos/${a.id}`} className="card-interactive flex items-center gap-4">
        <div className="flex h-16 w-16 flex-none flex-col items-center justify-center rounded-xl bg-blush text-wine">
          <span className="font-display text-xl font-semibold leading-none">{formatDateBR(a.startAt).slice(0, 2)}</span>
          <span className="mt-1 text-xs font-semibold uppercase">
            {new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, month: "short" }).format(a.startAt).replace(".", "")}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-semibold text-plum">{a.serviceName}</p>
          <p className="text-sm text-plum-muted">
            {formatDateBR(a.startAt)} às {formatTimeBR(a.startAt)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            <span className={`text-sm font-semibold ${muted ? "text-plum-muted" : "text-wine"}`}>{formatCents(a.priceCents)}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}

export default async function MeusAgendamentosPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ confirmado?: string }>;
}) {
  // Next 15: searchParams é assíncrono (em Next 14 o await é inofensivo).
  const searchParams = await searchParamsPromise;
  const user = await requireClient();

  const [appointments, site] = await Promise.all([
    prisma.appointment.findMany({ where: { clientId: user.id }, orderBy: { startAt: "desc" } }),
    getSiteSettings(),
  ]);

  const { upcoming, history } = splitUpcomingAndHistory(appointments);
  // `confirmado` traz o id da reserva recém-criada; só vale se ela estiver entre as reservas DESTA cliente.
  const justConfirmed = searchParams.confirmado ? appointments.find((a) => a.id === searchParams.confirmado) : undefined;

  return (
    <Page>
      {searchParams.confirmado && (
        <div className="mb-6">
          <Notice tone="success">
            <strong>Agendamento confirmado!</strong> Te esperamos no horário combinado.
            {justConfirmed && <AddToGoogleCalendar appointment={justConfirmed} site={site} />}
          </Notice>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Sua agenda</p>
          <h1 className="page-title mt-1">Meus agendamentos</h1>
        </div>
        <Link href="/agendar" className="btn-primary">
          Agendar horário
        </Link>
      </div>

      <section className="mt-10" aria-labelledby="proximos">
        <h2 id="proximos" className="font-display text-2xl font-semibold text-plum">
          Próximos horários
        </h2>
        <div className="gold-rule mt-2" aria-hidden="true" />
        <p className="mt-3 text-sm text-plum-muted">{cancelPolicyText(getBookingPolicy().clientCancelMinHours)}</p>
        <div className="mt-4">
          {upcoming.length === 0 ? (
            <EmptyState
              title="Nenhum horário marcado"
              action={
                <Link href="/agendar" className="btn-secondary">
                  Escolher um horário
                </Link>
              }
            >
              Quando você agendar, seus próximos atendimentos aparecem aqui.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((a) => (
                <AppointmentCard key={a.id} a={a} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-12" aria-labelledby="historico">
        <h2 id="historico" className="font-display text-2xl font-semibold text-plum">
          Histórico
        </h2>
        <div className="gold-rule mt-2" aria-hidden="true" />
        <div className="mt-4">
          {history.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gold/60 bg-white/60 px-6 py-8 text-center text-sm text-plum-muted">
              Seu histórico de atendimentos aparecerá aqui.
            </p>
          ) : (
            <ul className="space-y-3">
              {history.map((a) => (
                <AppointmentCard key={a.id} a={a} muted />
              ))}
            </ul>
          )}
        </div>
      </section>
    </Page>
  );
}
