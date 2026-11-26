import { prisma } from "@/lib/db";
import { getServiceCovers } from "@/lib/service-images";
import { ServiceImageView } from "@/components/ServiceImageView";
import { loadPriceByTypeEnabled, loadPriceTables } from "@/lib/pricing-data";
import { priceLabel } from "@/lib/pricing";
import { ServicePrice } from "@/components/ServicePrice";
import { EmptyState, Notice, Page, PageHeader, Stepper } from "@/components/ui";
import { ServiceIcon, ClockIcon } from "@/components/icons";
import { requireClient } from "@/lib/session";
import { countClientActiveFuture } from "@/lib/booking";
import { getBookingPolicy, limitReachedMessage } from "@/lib/policy";
import { getServiceInfo } from "@/lib/service-catalog";
import { PHOTOS } from "@/lib/site";

export const metadata = { title: "Escolha o serviço" };

export default async function EscolherServicoPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ indisponivel?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const user = await requireClient();
  const { maxActiveFutureBookings } = getBookingPolicy();
  const atLimit = (await countClientActiveFuture(user.id)) >= maxActiveFutureBookings;
  const services = await prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const covers = await getServiceCovers(services);
  const [priceByType, priceTables] = await Promise.all([loadPriceByTypeEnabled(), loadPriceTables(services.map((s) => s.id))]);

  return (
    <Page width="lg">
      <Stepper current={1} />
      <div className="mt-8">
        <PageHeader title="Escolha o" accent="serviço" subtitle="Etapa 1 de 4 — selecione o serviço que deseja agendar." />
      </div>

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
          <EmptyState title="Nenhum serviço disponível agora">Não há serviços abertos para agendamento no momento. Tente novamente mais tarde.</EmptyState>
        ) : (
          // Formulário GET nativo: funciona sem JavaScript e leva o serviço escolhido para a etapa do veículo.
          <form action="/agendar/veiculo" method="get">
            <fieldset>
              <legend className="sr-only">Serviços disponíveis</legend>
              <ul className="space-y-3">
                {services.map((service, i) => {
                  const info = getServiceInfo(service.name);
                  const photo = PHOTOS[info.photo];
                  return (
                    <li key={service.id}>
                      <label className="group flex cursor-pointer overflow-hidden rounded-2xl border border-line-strong bg-surface transition hover:border-brand/70 has-[:checked]:border-brand has-[:checked]:bg-brand/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-ink">
                        <input type="radio" name="serviceId" value={service.id} defaultChecked={i === 0} required className="peer sr-only" />
                        {/* Decorativa: o nome do serviço ao lado já descreve. Carrega sob demanda (lazy). */}
                        <ServiceImageView
                          photo={covers.get(service.id)}
                          fallback={photo}
                          decorative
                          sizes="(min-width: 640px) 176px, 96px"
                          className="hidden h-auto w-24 flex-none self-stretch object-cover sm:block sm:w-44"
                        />
                        <span className="flex min-w-0 flex-1 items-start gap-3 p-4">
                          <span className="mt-0.5 flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-brand/60 text-brand">
                            <ServiceIcon name={info.icon} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-display text-xl font-bold uppercase tracking-wide text-fg">{service.name}</span>
                            <span className="mt-0.5 block text-sm text-fg-muted">{info.description}</span>
                            <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                              <span className="inline-flex items-center gap-1.5 text-fg-muted">
                                <ClockIcon className="h-4 w-4" /> {service.durationMinutes} min
                              </span>
                              <ServicePrice
                                label={priceLabel({ enabled: priceByType, defaultCents: service.priceCents, table: priceTables.get(service.id) ?? {} })}
                                className="font-display text-xl font-bold text-brand !text-left"
                              />
                            </span>
                          </span>
                          <span aria-hidden="true" className="mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 border-brand/70">
                            <span className="hidden h-3 w-3 rounded-full bg-brand group-has-[:checked]:block" />
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            <button type="submit" className="btn-primary mt-6 w-full text-base" disabled={atLimit}>
              Continuar
            </button>
          </form>
        )}
      </div>
    </Page>
  );
}
