import Link from "next/link";
import { redirect } from "next/navigation";
import { requireClient } from "@/lib/session";
import { listVehicles } from "@/lib/vehicles";
import { LIMITS } from "@/lib/validation";
import { Page, PageHeader } from "@/components/ui";
import { VehicleForm } from "@/components/VehicleForm";

export const metadata = { title: "Adicionar veículo" };

export default async function NovoVeiculoPage() {
  const user = await requireClient();
  if ((await listVehicles(user.id)).length >= LIMITS.vehiclesPerUserMax) redirect("/minha-conta/veiculos");

  return (
    <Page width="lg">
      <Link href="/minha-conta/veiculos" className="link text-sm">
        ← Voltar para meus veículos
      </Link>
      <div className="mt-6">
        <PageHeader title="Novo" accent="veículo" subtitle="Informe os dados do seu veículo." />
      </div>
      <div className="card mt-6">
        <VehicleForm />
      </div>
    </Page>
  );
}
