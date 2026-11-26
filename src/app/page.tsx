import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PHOTOS } from "@/lib/site";
import { getServiceInfo } from "@/lib/service-catalog";
import { getServiceCovers } from "@/lib/service-images";
import { veiculoUrl } from "@/lib/booking-urls";
import { ServiceImageView } from "@/components/ServiceImageView";
import { getSiteSettings } from "@/lib/site-settings-cache";
import { PublicHeader } from "@/components/PublicHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { EmptyState } from "@/components/ui";
import { ClockIcon, ShieldIcon, SparklesIcon, UserIcon, CalendarIcon } from "@/components/icons";

const DIFFERENTIALS = [
  { icon: <ShieldIcon className="h-7 w-7" />, title: "Produtos profissionais", text: "Linha profissional que respeita a pintura, o couro e os plásticos do seu veículo." },
  { icon: <UserIcon className="h-7 w-7" />, title: "Atenção ao detalhe", text: "Cada etapa é conferida: rodas, caixas de roda, frestas e acabamento final." },
  { icon: <CalendarIcon className="h-7 w-7" />, title: "Agendamento online", text: "Escolha o serviço, o dia e o horário em poucos toques e receba a confirmação na hora." },
  { icon: <SparklesIcon className="h-7 w-7" />, title: "Acabamento de vitrine", text: "O resultado que você vê na foto: brilho profundo e interior renovado." },
];

export default async function HomePage() {
  const session = await getSession();

  if (session?.user) {
    redirect(session.user.role === "ADMIN" ? "/admin" : "/meus-agendamentos");
  }

  // A página inicial não mostra preços (decisão do dono): eles aparecem em /servicos e no agendamento.
  const [services, site] = await Promise.all([
    prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    getSiteSettings(),
  ]);
  const hero = PHOTOS.hero;
  const featured = services.slice(0, 3);
  const covers = await getServiceCovers(featured);

  return (
    <>
      <PublicHeader />

      <main id="conteudo">
        {/* Abertura: título e subtítulo sobre a foto do carro */}
        <section className="relative isolate overflow-hidden">
          <Image src={hero.src} alt="" width={hero.width} height={hero.height} priority sizes="100vw" className="absolute inset-x-0 top-0 -z-10 h-[28rem] w-full object-cover object-[72%_center] opacity-90 [-webkit-mask-image:linear-gradient(to_bottom,black_60%,transparent)] [mask-image:linear-gradient(to_bottom,black_60%,transparent)] md:inset-0 md:h-full md:opacity-80 md:[-webkit-mask-image:none] md:[mask-image:none]" />
          {/* Celular: véu escuro suave para o texto ler sobre o carro. Desktop: degradê da esquerda (título) para a direita (carro). */}
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/60 via-ink/45 to-transparent md:bg-gradient-to-r md:from-ink md:via-ink/75 md:to-ink/10" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-ink to-transparent" aria-hidden="true" />

          <div className="mx-auto max-w-6xl px-4 pb-10 pt-12 sm:px-6 md:pb-16 md:pt-20">
            <p className="eyebrow mb-3">{site.tagline}</p>
            <h1 className="max-w-3xl text-5xl leading-[0.9] text-fg sm:text-6xl lg:text-7xl">
              Estética <span className="accent block">Automotiva</span>
            </h1>
            <p className="mt-4 max-w-md text-lg font-medium text-fg">Escolha seu serviço e agende um horário.</p>
            <p className="mt-2 max-w-lg text-sm text-fg-muted">{site.intro}</p>
            <div className="accent-rule mt-5" aria-hidden="true" />
            {/* No celular o CTA do cabeçalho fica dentro do menu; este mantém "Agendar agora" à vista. */}
            <Link href="/agendar" className="btn-primary mt-5 md:hidden">
              Agendar agora
            </Link>
          </div>

        </section>

        {/* Serviços em destaque */}
        <section aria-labelledby="destaques" className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
          <h2 id="destaques" className="sr-only">
            Serviços em destaque
          </h2>
          {featured.length === 0 ? (
            <EmptyState title="Nossos serviços estarão aqui em breve">Ainda não há serviços disponíveis para agendamento. Volte daqui a pouco.</EmptyState>
          ) : (
            <ul className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-3">
              {featured.map((s) => {
                const photo = PHOTOS[getServiceInfo(s.name).photo];
                return (
                  <li key={s.id} className="min-w-0">
                    <Link href={veiculoUrl(s.id)} className="group flex h-full flex-col overflow-hidden rounded-2xl border border-brand/60 bg-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink">
                      {/* Abaixo da primeira tela: carregamento preguiçoso (sem priority). Sem foto cadastrada, usa o placeholder. */}
                      <div className="relative aspect-[3/2] w-full shrink-0 overflow-hidden">
                        <ServiceImageView photo={covers.get(s.id)} fallback={photo} sizes="(min-width: 768px) 33vw, 100vw" className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-[1.02]" />
                      </div>
                      <span className="block flex-1 px-4 py-3 font-display font-extrabold text-ink">
                        <span className="block break-words text-2xl leading-tight">{s.name}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-5 text-center">
            <Link href="/servicos" className="link inline-flex min-h-[44px] items-center">
              Ver todos os serviços
            </Link>
          </p>
        </section>

        {/* Diferenciais */}
        <section aria-labelledby="diferenciais" className="border-y border-line bg-surface py-14 md:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="eyebrow">Por que a Garage Zero Zero</p>
            <h2 id="diferenciais" className="mt-2 text-4xl text-fg sm:text-5xl">
              Cuidado em <span className="accent">cada detalhe</span>
            </h2>
            <div className="accent-rule mt-4" aria-hidden="true" />
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {DIFFERENTIALS.map((d) => (
                <li key={d.title} className="rounded-2xl border border-line bg-ink p-5">
                  <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-brand/60 text-brand">{d.icon}</span>
                  <h3 className="mt-4 text-xl text-fg">{d.title}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{d.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Todos os serviços, em lista curta */}
        {services.length > 3 && (
          <section aria-labelledby="todos" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="todos" className="text-4xl text-fg sm:text-5xl">
              Nossos <span className="accent">serviços</span>
            </h2>
            <div className="accent-rule mt-4" aria-hidden="true" />
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {services.map((s) => (
                <li key={s.id} className="rounded-xl border border-line bg-surface px-4 py-3">
                  <span className="block font-display text-xl font-bold uppercase tracking-wide text-fg">{s.name}</span>
                  <span className="flex items-center gap-1.5 text-sm text-fg-muted">
                    <ClockIcon className="h-4 w-4" /> {s.durationMinutes} min
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <SiteFooter />
    </>
  );
}
