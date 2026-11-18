import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireClient } from "@/lib/session";
import { listVehicles, vehicleLabel } from "@/lib/vehicles";
import { getNotesDraft } from "@/lib/booking-draft";
import { horarioUrl } from "@/lib/booking-urls";
import { LIMITS } from "@/lib/validation";
import { Page, PageHeader, Stepper } from "@/components/ui";
import { VehicleStepForm } from "@/components/VehicleStepForm";

export const metadata = { title: "Dados do veículo" };

export default async function VeiculoPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ serviceId?: string; startAt?: string }>;
}) {
  const { serviceId, startAt } = await searchParamsPromise;
  if (!serviceId) redirect("/agendar");
  const user = await requireClient();

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.active) redirect("/agendar?indisponivel=1");

  const startDate = startAt ? new Date(startAt) : null;
  if (!startDate || Number.isNaN(startDate.getTime()) || startDate.getTime() < Date.now()) redirect(horarioUrl(serviceId, { conflito: true }));

  // Só os veículos da própria cliente (listVehicles filtra pelo dono da sessão, nunca por um ID vindo da URL).
  const [vehicles, notes] = await Promise.all([listVehicles(user.id), getNotesDraft()]);

  return (
    <Page>
      <Stepper current={3} serviceId={service.id} startAt={startDate.toISOString()} />
      <div className="mt-8">
        <PageHeader title="Dados do" accent="veículo" subtitle={`Etapa 3 de 4 — informe o veículo para ${service.name}.`} />
      </div>
      <VehicleStepForm
        serviceId={service.id}
        startAtIso={startDate.toISOString()}
        vehicles={vehicles.map((v) => ({ id: v.id, label: vehicleLabel(v), plate: v.plate }))}
        initialNotes={notes ?? ""}
        atLimit={vehicles.length >= LIMITS.vehiclesPerUserMax}
      />
    </Page>
  );
}
