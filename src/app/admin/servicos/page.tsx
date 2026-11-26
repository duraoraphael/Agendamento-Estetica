import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { toggleServiceActiveAction } from "./actions";
import { countServicePhotos, getServiceCovers } from "@/lib/service-images";
import { DeleteServiceButton } from "@/components/DeleteServiceButton";
import { getServiceInfo } from "@/lib/service-catalog";
import { PHOTOS } from "@/lib/site";
import { ServiceImageView } from "@/components/ServiceImageView";
import { loadPriceByTypeEnabled, loadPriceTables } from "@/lib/pricing-data";
import { priceLabel } from "@/lib/pricing";

export default async function ServicosPage() {
  const services = await prisma.service.findMany({ orderBy: { createdAt: "asc" } });
  const covers = await getServiceCovers(services);
  const photoCounts = await countServicePhotos(services.map((s) => s.id));
  const [priceByType, priceTables] = await Promise.all([loadPriceByTypeEnabled(), loadPriceTables(services.map((s) => s.id))]);
  // Reservas por serviço (qualquer situação): quem tem histórico não pode ser excluído, só desativado.
  const appointmentCounts = new Map(
    (await prisma.appointment.groupBy({ by: ["serviceId"], _count: { _all: true } })).map((r) => [r.serviceId, r._count._all]),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Serviços</h1>
        <Link href="/admin/servicos/novo" className="btn-primary">
          + Novo serviço
        </Link>
      </div>

      {!priceByType && [...priceTables.values()].some((t) => Object.keys(t).length > 0) && (
        <div className="notice-warning" role="status">
          <p>
            Há preços por tipo de veículo salvos, mas a cobrança por tipo de veículo está desligada: as clientes estão pagando o preço padrão.{" "}
            <Link href="/admin/configuracoes" className="font-semibold underline underline-offset-4">
              Ligar em Configurações
            </Link>
          </p>
        </div>
      )}

      {services.length === 0 ? (
        <div className="card text-center text-fg-muted">
          Nenhum serviço cadastrado ainda. Cadastre o primeiro para que as clientes possam agendar.
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((service) => (
            <div key={service.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ServiceImageView
                  photo={covers.get(service.id)}
                  fallback={PHOTOS[getServiceInfo(service.name).photo]}
                  decorative
                  sizes="64px"
                  className="h-12 w-16 flex-none rounded-md object-cover"
                />
                <div className="min-w-0">
                  <p className="font-semibold text-fg">{service.name}</p>
                  <p className="text-sm text-fg-muted">
                    {formatCents(service.priceCents)}
                    {(() => {
                      // Com a chave ligada e preços por categoria diferentes, mostra o menor valor aplicável.
                      const label = priceLabel({ enabled: priceByType, defaultCents: service.priceCents, table: priceTables.get(service.id) ?? {} });
                      return label.prefix ? ` · por tipo: ${label.prefix.toLowerCase()} ${label.text}` : "";
                    })()}
                    {" · "}
                    {service.durationMinutes} min
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${service.active ? "bg-status-done-bg text-status-done" : "bg-status-cancelled-bg text-status-cancelled"}`}>
                  {service.active ? "Ativo" : "Inativo"}
                </span>
                <Link href={`/admin/servicos/${service.id}/editar`} className="btn-ghost text-brand">
                  Editar
                </Link>
                <form action={toggleServiceActiveAction.bind(null, service.id, !service.active)}>
                  <button type="submit" className="btn-ghost">
                    {service.active ? "Desativar" : "Ativar"}
                  </button>
                </form>
                <DeleteServiceButton
                  serviceId={service.id}
                  serviceName={service.name}
                  appointmentCount={appointmentCounts.get(service.id) ?? 0}
                  photoCount={photoCounts.get(service.id) ?? 0}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
