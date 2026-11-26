import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCents, formatDateBR, formatTimeBR } from "@/lib/format";
import { ConfirmBookingForm } from "@/components/ConfirmBookingForm";
import { Page, PageHeader, Stepper } from "@/components/ui";
import { cancelPolicyText, getBookingPolicy } from "@/lib/policy";
import { LocationInfo } from "@/components/LocationInfo";
import { getSiteSettings } from "@/lib/site-settings-cache";
import { horarioUrl, veiculoUrl } from "@/lib/booking-urls";
import { requireClient } from "@/lib/session";
import { vehicleLabel } from "@/lib/vehicles";
import { resolveBookingVehicle } from "@/lib/booking-vehicle";
import { VEHICLE_TYPE_LABELS, isVehicleType } from "@/lib/pricing";
import { getNotesDraft } from "@/lib/booking-draft";
import { maskPlate } from "@/lib/plate";
import { getServiceInfo } from "@/lib/service-catalog";
import { PHOTOS } from "@/lib/site";
import { getServiceCovers } from "@/lib/service-images";
import { ServiceImageView } from "@/components/ServiceImageView";
import { CalendarIcon, CarIcon, ClockIcon, ServiceIcon } from "@/components/icons";

export const metadata = { title: "Revise seu agendamento" };

export default async function RevisarAgendamentoPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ serviceId?: string; startAt?: string; vehicleId?: string }>;
}) {
  const { serviceId, startAt, vehicleId } = await searchParamsPromise;
  if (!serviceId || !startAt) redirect("/agendar");
  const user = await requireClient();

  const [service, site] = await Promise.all([prisma.service.findUnique({ where: { id: serviceId } }), getSiteSettings()]);
  if (!service || !service.active) redirect("/agendar?indisponivel=1");

  // O veículo vem da URL, mas só vale se for DA CLIENTE (e, com a cobrança por tipo ligada, se tiver tipo). Senão volta
  // para a etapa do veículo. O valor mostrado aqui é o calculado no servidor agora; a reserva o recalcula e confere.
  const resolved = await resolveBookingVehicle(user.id, vehicleId, service);
  if (!resolved.ok) redirect(veiculoUrl(serviceId));
  const { vehicle, price } = resolved;

  const startDate = new Date(startAt);
  if (Number.isNaN(startDate.getTime()) || startDate.getTime() < Date.now()) {
    redirect(horarioUrl(serviceId, { vehicleId: vehicle.id, conflito: true }));
  }

  const notes = (await getNotesDraft()) ?? "";
  const info = getServiceInfo(service.name);
  const cover = (await getServiceCovers([service])).get(service.id);

  const rows = [
    { icon: <ServiceIcon name={info.icon} className="h-6 w-6" />, label: "Serviço", value: service.name },
    { icon: <CalendarIcon className="h-6 w-6" />, label: "Data e horário", value: `${formatDateBR(startDate)} às ${formatTimeBR(startDate)}` },
    { icon: <ClockIcon className="h-6 w-6" />, label: "Duração", value: `${service.durationMinutes} min` },
    {
      icon: <CarIcon className="h-6 w-6" />,
      label: "Veículo",
      value: `${vehicleLabel(vehicle)}${isVehicleType(vehicle.vehicleType) ? ` (${VEHICLE_TYPE_LABELS[vehicle.vehicleType]})` : ""} · placa ${maskPlate(vehicle.plate)}`,
    },
  ];

  return (
    <Page width="lg">
      <Stepper current={4} serviceId={service.id} vehicleId={vehicle.id} />
      <div className="mt-8">
        <PageHeader title="Revise seu" accent="agendamento" subtitle="Etapa 4 de 4 — confira os dados abaixo e confirme." />
      </div>

      <section aria-label="Resumo do agendamento" className="mt-6 overflow-hidden rounded-2xl border border-brand/50 bg-surface shadow-soft">
        {/* Decorativa: o nome do serviço está logo abaixo. Sem foto cadastrada, usa o placeholder. */}
        <ServiceImageView photo={cover} fallback={PHOTOS[info.photo]} decorative sizes="(min-width: 768px) 672px, 100vw" className="aspect-[16/7] w-full object-cover" />
        <dl className="divide-y divide-line px-5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-4 py-4">
              <span className="text-brand">{r.icon}</span>
              <div className="min-w-0">
                <dt className="text-sm text-fg-muted">{r.label}</dt>
                <dd className="font-display text-xl font-bold tracking-wide text-fg">{r.value}</dd>
              </div>
            </div>
          ))}
          {notes && (
            <div className="py-4">
              <dt className="text-sm text-fg-muted">Observações</dt>
              {/* Texto da cliente: exibido como texto puro (React escapa), preservando as quebras de linha. */}
              <dd className="mt-1 whitespace-pre-line break-words text-fg">{notes}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4 py-5">
            <dt className="font-semibold text-fg">Valor</dt>
            <dd className="font-display text-3xl font-extrabold text-brand">{formatCents(price.cents)}</dd>
          </div>
        </dl>
      </section>

      <LocationInfo site={site} className="mt-4" />

      <p className="mt-4 text-sm text-fg-muted">{cancelPolicyText(getBookingPolicy().clientCancelMinHours)}</p>
      {/* `key` com o valor: depois de "Rever o agendamento" o formulário recomeça limpo (sem o aviso do valor antigo). */}
      <ConfirmBookingForm key={price.cents} serviceId={service.id} startAtIso={startDate.toISOString()} vehicleId={vehicle.id} notes={notes} expectedPriceCents={price.cents} />
    </Page>
  );
}
