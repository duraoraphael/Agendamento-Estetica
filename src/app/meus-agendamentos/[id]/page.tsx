import { notFound } from "next/navigation";
import Link from "next/link";
import { requireClient } from "@/lib/session";
import { getAppointmentForClient } from "@/lib/appointments";
import { formatCents, formatDateBR, formatTimeBR } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { Page } from "@/components/ui";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { canClientCancel, cancelPolicyText, getBookingPolicy } from "@/lib/policy";
import { AddToGoogleCalendar } from "@/components/AddToGoogleCalendar";
import { StudioInfo } from "@/components/StudioInfo";
import { getSiteSettings } from "@/lib/site-settings-cache";

function CancelOrPolicy({ appointment }: { appointment: { id: string; startAt: Date } }) {
  const { clientCancelMinHours } = getBookingPolicy();
  const policyText = cancelPolicyText(clientCancelMinHours);
  if (canClientCancel(appointment.startAt, new Date(), clientCancelMinHours)) {
    return <CancelBookingButton appointmentId={appointment.id} policyText={policyText} />;
  }
  return (
    <p className="mt-6 rounded-2xl border border-gold/40 bg-blush-light px-5 py-4 text-sm text-plum">
      O prazo para cancelar pelo site já passou. Para cancelar este horário, fale com o estúdio.
    </p>
  );
}

export default async function DetalheAgendamentoPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 15: params é assíncrono (em Next 14 o await é inofensivo).
  const { id } = await params;
  const user = await requireClient();

  // Nunca confiar no id da URL: getAppointmentForClient só retorna a reserva
  // se ela pertencer à cliente autenticada (veja lib/appointments.ts).
  const [appointment, site] = await Promise.all([getAppointmentForClient(id, user.id), getSiteSettings()]);

  if (!appointment) {
    notFound();
  }

  return (
    <Page>
      <Link href="/meus-agendamentos" className="link text-sm">
        ← Voltar para meus agendamentos
      </Link>

      <section aria-label="Detalhes do agendamento" className="mt-5 overflow-hidden rounded-2xl border border-gold/50 bg-white shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-blush px-6 py-5">
          <h1 className="font-display text-2xl font-semibold text-plum">{appointment.serviceName}</h1>
          <StatusBadge status={appointment.status} />
        </div>
        <dl className="divide-y divide-blush-deep/50 px-6">
          <div className="flex justify-between gap-4 py-4">
            <dt className="text-plum-muted">Data</dt>
            <dd className="font-semibold text-plum">{formatDateBR(appointment.startAt)}</dd>
          </div>
          <div className="flex justify-between gap-4 py-4">
            <dt className="text-plum-muted">Horário</dt>
            <dd className="font-semibold text-plum">{formatTimeBR(appointment.startAt)}</dd>
          </div>
          <div className="flex justify-between gap-4 py-4">
            <dt className="text-plum-muted">Duração</dt>
            <dd className="font-medium text-plum">{appointment.durationMinutes} min</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-5">
            <dt className="font-semibold text-plum">Valor</dt>
            <dd className="font-display text-2xl font-semibold text-wine">{formatCents(appointment.priceCents)}</dd>
          </div>
        </dl>
      </section>

      <StudioInfo site={site} className="mt-5" />

      <AddToGoogleCalendar appointment={appointment} site={site} />

      {appointment.status === "CONFIRMADA" && appointment.startAt > new Date() && (
        <CancelOrPolicy appointment={appointment} />
      )}
    </Page>
  );
}
