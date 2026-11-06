import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { toggleServiceActiveAction } from "./actions";

export default async function ServicosPage() {
  const services = await prisma.service.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-plum sm:text-3xl">Serviços</h1>
        <Link href="/admin/servicos/novo" className="btn-primary">
          + Novo serviço
        </Link>
      </div>

      {services.length === 0 ? (
        <div className="card text-center text-plum-muted">
          Nenhum serviço cadastrado ainda. Cadastre o primeiro para que as clientes possam agendar.
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((service) => (
            <div key={service.id} className="card flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-plum">{service.name}</p>
                <p className="text-sm text-plum-muted">
                  {formatCents(service.priceCents)} · {service.durationMinutes} min
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${service.active ? "bg-status-done-bg text-status-done" : "bg-status-cancelled-bg text-status-cancelled"}`}>
                  {service.active ? "Ativo" : "Inativo"}
                </span>
                <Link href={`/admin/servicos/${service.id}/editar`} className="btn-ghost text-wine">
                  Editar
                </Link>
                <form action={toggleServiceActiveAction.bind(null, service.id, !service.active)}>
                  <button type="submit" className="btn-ghost">
                    {service.active ? "Desativar" : "Ativar"}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
