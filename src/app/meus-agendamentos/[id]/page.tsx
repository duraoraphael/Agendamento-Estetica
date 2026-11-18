import { notFound } from "next/navigation";
import Link from "next/link";
import { requireClient } from "@/lib/session";
import { getAppointmentForClient } from "@/lib/appointments";
import { formatCents, formatDateBR, formatTimeBR } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { Notice, Page, PageHeader } from "@/components/ui";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { canClientCancel, cancelPolicyText, getBookingPolicy } from "@/lib/policy";
import { AddToGoogleCalendar } from "@/components/AddToGoogleCalendar";
import { LocationInfo } from "@/components/LocationInfo";
import { getSiteSettings } from "@/lib/site-settings-cache";
import { whatsappLink } from "@/lib/site-settings";
import { formatPlate } from "@/lib/plate";
import { idSchema } from "@/lib/validation";
import { CalendarIcon, CarIcon, ClockIcon, WrenchIcon } from "@/components/icons";

export const metadata = { title: "Detalhes do agendamento" };

const LEGACY_VEHICLE = "Veículo não informado — agendamento anterior à atualização";

export default async function DetalheAgendamentoPage({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reagendado?: string; reagendar?: string }>;
}) {
  const { id } = await params;
  const searchParams = await searchParamsPromise;
  const user = await requireClient();
  if (!idSchema.safeParse(id).success) notFound();

  // Nunca confiar no id da URL: getAppointmentForClient só retorna a reserva
  // se ela pertencer à cliente autenticada (veja lib/appointments.ts).
  const [appointment, site] = await Promise.all([getAppointmentForClient(id, user.id), getSiteSettings()]);
  if (!appointment) notFound();

  const { clientCancelMinHours } = getBookingPolicy();
  const policyText = cancelPolicyText(clientCancelMinHours);
  const isFutureConfirmed = appointment.status === "CONFIRMADA" && appointment.startAt > new Date();
  const withinPolicy = isFutureConfirmed && canClientCancel(appointment.startAt, new Date(), clientCancelMinHours);
  const vehicle = [appointment.vehicleBrandSnapshot, appointment.vehicleModelSnapshot].filter(Boolean).join(" ");
  const wa = whatsappLink(site.whatsapp);

  const rows = [
    { icon: <WrenchIcon className="h-5 w-5" />, label: "Serviço", value: appointment.serviceName },
    { icon: <CalendarIcon className="h-5 w-5" />, label: "Data", value: formatDateBR(appointment.startAt) },
    { icon: <ClockIcon className="h-5 w-5" />, label: "Horário", value: formatTimeBR(appointment.startAt) },
    { icon: <ClockIcon className="h-5 w-5" />, label: "Duração", value: `${appointment.durationMinutes} min` },
    { icon: <CarIcon className="h-5 w-5" />, label: "Veículo", value: vehicle || LEGACY_VEHICLE },
    ...(appointment.vehiclePlateSnapshot ? [{ icon: <CarIcon className="h-5 w-5" />, label: "Placa", value: formatPlate(appointment.vehiclePlateSnapshot) }] : []),
  ];

  return (
    <Page width="lg">
      <Link href="/meus-agendamentos" className="link text-sm">
        ← Voltar para meus agendamentos
      </Link>
      <div className="mt-6">
        <PageHeader title="Detalhes do" accent="agendamento" />
      </div>

      {searchParams.reagendado && (
        <div className="mt-5">
          <Notice tone="success">Agendamento reagendado! O novo horário já está confirmado.</Notice>
        </div>
      )}
      {searchParams.reagendar === "indisponivel" && (
        <div className="mt-5">
          <Notice tone="warning">Este agendamento não pode mais ser reagendado pelo site. {policyText}</Notice>
        </div>
      )}

      <section aria-label="Detalhes do agendamento" className="mt-6 overflow-hidden rounded-2xl border border-brand/50 bg-surface shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-2 px-5 py-4">
          <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-fg">{appointment.serviceName}</h2>
          <StatusBadge status={appointment.status} />
        </div>
        <dl className="divide-y divide-line px-5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-4 py-3.5">
              <dt className="flex items-center gap-2 text-fg-muted">
                <span className="text-brand">{r.icon}</span>
                {r.label}
              </dt>
              <dd className="text-right font-semibold text-fg">{r.value}</dd>
            </div>
          ))}
          {appointment.notes && (
            <div className="py-3.5">
              <dt className="text-fg-muted">Observações</dt>
              {/* Texto da cliente: sempre como texto puro (React escapa), preservando quebras de linha. */}
              <dd className="mt-1 whitespace-pre-line break-words text-fg">{appointment.notes}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4 py-4">
            <dt className="font-semibold text-fg">Valor</dt>
            <dd className="font-display text-2xl font-extrabold text-brand">{formatCents(appointment.priceCents)}</dd>
          </div>
        </dl>
      </section>

      <LocationInfo site={site} className="mt-5" />

      {wa && (
        <p className="mt-3">
          <a href={wa} target="_blank" rel="noopener noreferrer" className="link">
            Falar pelo WhatsApp<span className="sr-only"> (abre em uma nova aba)</span>
          </a>
        </p>
      )}

      <AddToGoogleCalendar appointment={appointment} site={site} />

      {isFutureConfirmed && (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {withinPolicy && (
            <Link href={`/meus-agendamentos/${appointment.id}/reagendar`} className="btn-primary w-full sm:w-auto">
              Reagendar
            </Link>
          )}
        </div>
      )}

      {isFutureConfirmed &&
        (withinPolicy ? (
          <CancelBookingButton appointmentId={appointment.id} policyText={policyText} />
        ) : (
          <p className="mt-6 rounded-2xl border border-brand/40 bg-surface px-5 py-4 text-sm text-fg">
            O prazo para reagendar ou cancelar pelo site já passou. Para mudar este horário, fale com a Garage Zero Zero.
          </p>
        ))}
    </Page>
  );
}
