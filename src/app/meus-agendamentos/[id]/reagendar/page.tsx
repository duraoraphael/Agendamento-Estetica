import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireClient } from "@/lib/session";
import { getAppointmentForClient } from "@/lib/appointments";
import { buildCalendarRange } from "@/lib/calendar-range";
import { canClientCancel, getBookingPolicy } from "@/lib/policy";
import { formatDateBR, formatTimeBR } from "@/lib/format";
import { idSchema } from "@/lib/validation";
import { SlotPicker } from "@/components/SlotPicker";
import { Page, PageHeader } from "@/components/ui";
import { CalendarIcon } from "@/components/icons";

export const metadata = { title: "Reagendar" };

export default async function ReagendarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireClient();
  if (!idSchema.safeParse(id).success) notFound();

  // Nunca confiar no id da URL: reserva de outra cliente responde 404.
  const appointment = await getAppointmentForClient(id, user.id);
  if (!appointment) notFound();

  // Só reserva confirmada e futura, dentro do prazo da política (a mesma do cancelamento). O servidor revalida ao confirmar.
  const { clientCancelMinHours } = getBookingPolicy();
  const allowed = appointment.status === "CONFIRMADA" && appointment.startAt > new Date() && canClientCancel(appointment.startAt, new Date(), clientCancelMinHours);
  if (!allowed) redirect(`/meus-agendamentos/${appointment.id}?reagendar=indisponivel`);

  const calendar = await buildCalendarRange();

  return (
    <Page width="xl">
      <Link href={`/meus-agendamentos/${appointment.id}`} className="link text-sm">
        ← Voltar para o agendamento
      </Link>
      <div className="mt-6">
        <PageHeader accent="Reagendar" subtitle={`Escolha uma nova data e um novo horário para ${appointment.serviceName}.`} />
      </div>

      <p className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-fg-muted">
        <CalendarIcon className="h-5 w-5 text-brand" />
        Horário atual: <strong className="text-fg">{formatDateBR(appointment.startAt)} às {formatTimeBR(appointment.startAt)}</strong>. Ele só muda quando você confirmar o novo horário.
      </p>

      <SlotPicker serviceId={appointment.serviceId} calendar={calendar} mode="reschedule" appointmentId={appointment.id} startAtIso={appointment.startAt.toISOString()} />
    </Page>
  );
}
