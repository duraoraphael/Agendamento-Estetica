import Link from "next/link";
import { requireClient } from "@/lib/session";
import { listVehicles, vehicleLabel } from "@/lib/vehicles";
import { formatPlate } from "@/lib/plate";
import { LIMITS } from "@/lib/validation";
import { VEHICLE_TYPE_LABELS, isVehicleType } from "@/lib/pricing";
import { EmptyState, Notice, Page, PageHeader } from "@/components/ui";
import { CarIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";

export const metadata = { title: "Meus veículos" };

export default async function VeiculosPage({ searchParams: searchParamsPromise }: { searchParams: Promise<{ salvo?: string; removido?: string }> }) {
  const searchParams = await searchParamsPromise;
  const user = await requireClient();
  const vehicles = await listVehicles(user.id);
  const atLimit = vehicles.length >= LIMITS.vehiclesPerUserMax;

  return (
    <Page width="lg">
      <Link href="/minha-conta" className="link text-sm">
        ← Voltar para minha conta
      </Link>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="Meus" accent="veículos" />
        {!atLimit && (
          <Link href="/minha-conta/veiculos/novo" className="btn-primary">
            <PlusIcon className="h-5 w-5" /> Adicionar veículo
          </Link>
        )}
      </div>

      {searchParams.salvo && (
        <div className="mt-5">
          <Notice tone="success">Veículo salvo.</Notice>
        </div>
      )}
      {searchParams.removido && (
        <div className="mt-5">
          <Notice tone="success">Veículo removido.</Notice>
        </div>
      )}
      {atLimit && (
        <div className="mt-5">
          <Notice tone="warning">Você chegou ao limite de {LIMITS.vehiclesPerUserMax} veículos. Remova um para cadastrar outro.</Notice>
        </div>
      )}

      <div className="mt-6">
        {vehicles.length === 0 ? (
          <EmptyState
            title="Nenhum veículo cadastrado"
            action={
              <Link href="/minha-conta/veiculos/novo" className="btn-primary">
                Cadastrar meu primeiro veículo
              </Link>
            }
          >
            Cadastre seu veículo para agendar mais rápido.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {vehicles.map((v) => (
              <li key={v.id}>
                <Link href={`/minha-conta/veiculos/${v.id}/editar`} className="card-interactive flex items-center gap-4">
                  <span className="flex h-12 w-12 flex-none items-center justify-center rounded-lg border border-brand/60 text-brand">
                    <CarIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-xl font-bold uppercase tracking-wide text-fg">{vehicleLabel(v)}</span>
                    <span className="block text-sm text-fg-muted">
                      {isVehicleType(v.vehicleType) ? `${VEHICLE_TYPE_LABELS[v.vehicleType]} · ` : ""}
                      {formatPlate(v.plate)}
                      {v.year ? ` · ${v.year}` : ""}
                      {v.color ? ` · ${v.color}` : ""}
                    </span>
                    {!isVehicleType(v.vehicleType) && (
                      <span className="mt-1 block text-sm font-semibold text-brand">Tipo não informado — toque para completar</span>
                    )}
                  </span>
                  <ChevronRightIcon className="h-5 w-5 text-brand" />
                  <span className="sr-only">Editar veículo</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}
