import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireClient } from "@/lib/session";
import { formatCents } from "@/lib/format";
import { buildCalendarRange } from "@/lib/calendar-range";
import { isValidDateKey } from "@/lib/availability";
import { resolveBookingVehicle } from "@/lib/booking-vehicle";
import { vehicleLabel } from "@/lib/vehicles";
import { veiculoUrl } from "@/lib/booking-urls";
import { SlotPicker } from "@/components/SlotPicker";
import { Notice, Page, PageHeader, Stepper } from "@/components/ui";
import { CarIcon, ClockIcon } from "@/components/icons";

export const metadata = { title: "Escolha a data e o horário" };

export default async function EscolherHorarioPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ serviceId?: string; vehicleId?: string; conflito?: string; data?: string; hora?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const serviceId = searchParams.serviceId;
  if (!serviceId) redirect("/agendar");
  const user = await requireClient();

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.active) redirect("/agendar?indisponivel=1");

  // O veículo vem da URL, mas só vale se for DA CLIENTE (e, com a cobrança por tipo ligada, se tiver tipo). Senão, a
  // pessoa volta à etapa do veículo, que cadastra, escolhe ou completa. Sem revelar nada sobre veículos de outras pessoas.
  const resolved = await resolveBookingVehicle(user.id, searchParams.vehicleId, service);
  if (!resolved.ok) redirect(veiculoUrl(service.id, { data: searchParams.data, hora: searchParams.hora }));

  const calendar = await buildCalendarRange();
  // Preferências vindas do agendamento rápido da página inicial. São só sugestão de partida: validadas aqui, e a lista
  // de horários (e a confirmação) continuam sendo as regras do servidor.
  const initialDay = searchParams.data && isValidDateKey(searchParams.data) && searchParams.data >= calendar.todayKey && searchParams.data <= calendar.maxKey ? searchParams.data : undefined;
  const initialTime = searchParams.hora && /^([01]\d|2[0-3]):[0-5]\d$/.test(searchParams.hora) ? searchParams.hora : undefined;

  return (
    <Page width="xl">
      <Stepper current={3} serviceId={service.id} vehicleId={resolved.vehicle.id} />
      <div className="mt-8">
        <PageHeader title="Escolha a" accent="data e o horário" subtitle="Etapa 3 de 4 — selecione uma data e um horário disponível." />
      </div>

      {searchParams.conflito && (
        <div className="mt-5">
          <Notice tone="warning">Esse horário não está mais disponível (acabou de ser reservado). Escolha outro horário abaixo — a lista já foi atualizada.</Notice>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-brand/40 bg-surface px-5 py-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-bold uppercase tracking-wide text-fg">{service.name}</p>
          <p className="flex items-center gap-1.5 text-sm text-fg-muted">
            <ClockIcon className="h-4 w-4" /> {service.durationMinutes} minutos
          </p>
          <p className="flex items-center gap-1.5 truncate text-sm text-fg-muted">
            <CarIcon className="h-4 w-4 flex-none" /> {vehicleLabel(resolved.vehicle)}
          </p>
        </div>
        <p className="font-display text-2xl font-bold text-brand">{formatCents(resolved.price.cents)}</p>
      </div>

      <SlotPicker serviceId={service.id} vehicleId={resolved.vehicle.id} calendar={calendar} initialDay={initialDay} initialTime={initialTime} />
    </Page>
  );
}
