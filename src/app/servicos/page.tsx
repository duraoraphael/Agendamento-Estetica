import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadPriceByTypeEnabled, loadPriceTables } from "@/lib/pricing-data";
import { priceLabel } from "@/lib/pricing";
import { ServicePrice } from "@/components/ServicePrice";
import { getServiceInfo } from "@/lib/service-catalog";
import { PHOTOS } from "@/lib/site";
import { getServiceGalleries } from "@/lib/service-images";
import { veiculoUrl } from "@/lib/booking-urls";
import { ServiceImageView } from "@/components/ServiceImageView";
import { ServicePhotoCarousel } from "@/components/ServicePhotoCarousel";
import { PublicHeader } from "@/components/PublicHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { EmptyState, PageHeader } from "@/components/ui";
import { CheckIcon, ClockIcon, ServiceIcon } from "@/components/icons";

export const metadata = {
  title: "Serviços",
  description: "Lavagem detalhada, higienização interna, polimento, cristalização, vitrificação e mais. Veja duração, preço e benefícios de cada serviço.",
};

export default async function ServicosPage() {
  const services = await prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const galleries = await getServiceGalleries(services);
  const [priceByType, priceTables] = await Promise.all([loadPriceByTypeEnabled(), loadPriceTables(services.map((s) => s.id))]);

  return (
    <>
      <PublicHeader />
      <main id="conteudo" className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <PageHeader title="Nossos" accent="serviços" subtitle="Escolha o cuidado ideal para o seu veículo. Os preços são os cadastrados hoje; o valor final do agendamento fica gravado na reserva." />

        <div className="mt-10">
          {services.length === 0 ? (
            <EmptyState title="Nossos serviços estarão aqui em breve">Ainda não há serviços disponíveis para agendamento. Volte daqui a pouco.</EmptyState>
          ) : (
            <ul className="space-y-6">
              {services.map((s, i) => {
                const info = getServiceInfo(s.name);
                const placeholder = PHOTOS[info.photo];
                const photos = galleries.get(s.id) ?? [];
                const titleId = `servico-${s.id}`;
                return (
                  <li key={s.id} className="overflow-hidden rounded-2xl border border-brand/45 bg-surface md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                    <div className="min-w-0 bg-ink">
                      {photos.length > 1 ? (
                        <ServicePhotoCarousel photos={photos} fallback={placeholder} serviceName={s.name} priority={i === 0} />
                      ) : (
                        <ServiceImageView
                          photo={photos[0]}
                          fallback={placeholder}
                          sizes="(min-width: 768px) 40vw, 100vw"
                          priority={i === 0}
                          className="aspect-[3/2] w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-5 sm:p-6">
                      <div className="flex items-start gap-3">
                        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-lg border border-brand/60 text-brand">
                          <ServiceIcon name={info.icon} />
                        </span>
                        <div>
                          <h2 id={titleId} className="text-3xl text-fg">{s.name}</h2>
                          <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
                            <ClockIcon className="h-4 w-4" /> Duração média: {s.durationMinutes} min
                          </p>
                        </div>
                      </div>
                      <p className="mt-4 text-fg-muted">{info.description}</p>
                      <ul className="mt-4 space-y-1.5">
                        {info.benefits.map((b) => (
                          <li key={b} className="flex items-start gap-2 text-sm text-fg">
                            <CheckIcon className="mt-0.5 h-4 w-4 text-brand" />
                            {b}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                        {(() => {
                          const label = priceLabel({ enabled: priceByType, defaultCents: s.priceCents, table: priceTables.get(s.id) ?? {} });
                          return (
                            <p>
                              {/* O "A partir de" já faz o papel do rótulo quando o preço varia por tipo de veículo. */}
                              {!label.prefix && <span className="block text-xs font-bold uppercase tracking-wider text-fg-muted">Preço</span>}
                              <ServicePrice label={label} className="font-display text-3xl font-extrabold text-brand !text-left" />
                            </p>
                          );
                        })()}
                        <Link href={veiculoUrl(s.id)} aria-describedby={titleId} className="btn-primary w-full sm:w-auto">
                          Agendar
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
