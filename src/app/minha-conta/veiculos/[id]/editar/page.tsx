import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/session";
import { getVehicleForUser } from "@/lib/vehicles";
import { idSchema } from "@/lib/validation";
import { Page, PageHeader } from "@/components/ui";
import { DeleteVehicleButton, VehicleForm } from "@/components/VehicleForm";

export const metadata = { title: "Editar veículo" };

export default async function EditarVeiculoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireClient();
  if (!idSchema.safeParse(id).success) notFound();

  // Nunca confiar no id da URL: veículo de outra cliente responde 404, igual a um id que não existe.
  const vehicle = await getVehicleForUser(user.id, id);
  if (!vehicle) notFound();

  return (
    <Page width="lg">
      <Link href="/minha-conta/veiculos" className="link text-sm">
        ← Voltar para meus veículos
      </Link>
      <div className="mt-6">
        <PageHeader title="Editar" accent="veículo" />
      </div>
      <div className="card mt-6">
        <VehicleForm
          vehicleId={vehicle.id}
          defaults={{ brand: vehicle.brand, model: vehicle.model, plate: vehicle.plate, year: vehicle.year, color: vehicle.color, nickname: vehicle.nickname }}
        />
      </div>
      <div className="mt-6">
        <DeleteVehicleButton vehicleId={vehicle.id} />
      </div>
    </Page>
  );
}
