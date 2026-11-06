import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { EmptyState, Notice, Page, Stepper } from "@/components/ui";
import { LinkPending } from "@/components/LinkPending";
import { requireClient } from "@/lib/session";
import { countClientActiveFuture } from "@/lib/booking";
import { getBookingPolicy, limitReachedMessage } from "@/lib/policy";

export default async function EscolherServicoPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ indisponivel?: string }>;
}) {
  // Next 15: searchParams é assíncrono (em Next 14 o await é inofensivo).
  const searchParams = await searchParamsPromise;
  const user = await requireClient();
  const { maxActiveFutureBookings } = getBookingPolicy();
  const atLimit = (await countClientActiveFuture(user.id)) >= maxActiveFutureBookings;
  const services = await prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <Page>
      <Stepper current={1} />
      <h1 className="page-title mt-8">Escolha o serviço</h1>
      <p className="mt-2 text-plum-muted">Passo 1 de 3 — selecione o que você quer fazer hoje.</p>

      {atLimit && (
        <div className="mt-5">
          <Notice tone="warning">{limitReachedMessage(maxActiveFutureBookings)}</Notice>
        </div>
      )}

      {searchParams.indisponivel && (
        <div className="mt-5">
          <Notice tone="warning">O serviço escolhido não está mais disponível. Escolha outro abaixo.</Notice>
        </div>
      )}

      <div className="mt-6">
        {services.length === 0 ? (
          <EmptyState title="Nenhum serviço disponível agora">
            Não há serviços abertos para agendamento no momento. Tente novamente mais tarde.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {services.map((service) => (
              <li key={service.id}>
                <Link href={`/agendar/horario?serviceId=${service.id}`} className="card-interactive flex items-center justify-between gap-4">
                  <span>
                    <span className="block font-display text-lg font-semibold text-plum">{service.name}</span>
                    <span className="block text-sm text-plum-muted">{service.durationMinutes} minutos</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-display text-xl font-semibold text-wine">{formatCents(service.priceCents)}</span>
                    <span aria-hidden="true" className="text-wine">
                      →
                    </span>
                    <LinkPending />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}
