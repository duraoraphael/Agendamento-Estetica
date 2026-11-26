import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireClient } from "@/lib/session";
import { listVehicles, vehicleLabel } from "@/lib/vehicles";
import { getNotesDraft } from "@/lib/booking-draft";
import { LIMITS } from "@/lib/validation";
import { loadPriceByTypeEnabled, loadPriceTables, priceFor } from "@/lib/pricing-data";
import { VEHICLE_TYPES, type VehicleType } from "@/lib/pricing";
import { Page, PageHeader, Stepper } from "@/components/ui";
import { VehicleStepForm } from "@/components/VehicleStepForm";

export const metadata = { title: "Dados do veículo" };

export default async function VeiculoPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ serviceId?: string; data?: string; hora?: string }>;
}) {
  const { serviceId, data, hora } = await searchParamsPromise;
  if (!serviceId) redirect("/agendar");
  const user = await requireClient();

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.active) redirect("/agendar?indisponivel=1");

  // Só os veículos da própria cliente (listVehicles filtra pelo dono da sessão, nunca por um ID vindo da URL).
  const [vehicles, notes, enabled, tables] = await Promise.all([
    listVehicles(user.id),
    getNotesDraft(),
    loadPriceByTypeEnabled(),
    loadPriceTables([service.id]),
  ]);

  // Preço efetivo de cada categoria (a que não tem preço específico usa o padrão); com a chave desligada, todas = padrão.
  const table = tables.get(service.id) ?? {};
  const byType = Object.fromEntries(VEHICLE_TYPES.map((t) => [t, enabled ? (table[t] ?? service.priceCents) : service.priceCents])) as Record<VehicleType, number>;
  const options = vehicles.map((v) => {
    const price = priceFor(service, v.vehicleType, { enabled, tables });
    return { id: v.id, label: vehicleLabel(v), plate: v.plate, vehicleType: v.vehicleType, priceCents: price.status === "ok" ? price.cents : null };
  });

  return (
    <Page>
      <Stepper current={2} serviceId={service.id} />
      <div className="mt-8">
        <PageHeader title="Dados do" accent="veículo" subtitle={`Etapa 2 de 4 — informe o veículo para ${service.name}.`} />
      </div>
      <VehicleStepForm
        serviceId={service.id}
        data={data?.slice(0, 10)}
        hora={hora?.slice(0, 5)}
        vehicles={options}
        pricing={{ enabled, defaultCents: service.priceCents, byType }}
        initialNotes={notes ?? ""}
        atLimit={vehicles.length >= LIMITS.vehiclesPerUserMax}
      />
    </Page>
  );
}
