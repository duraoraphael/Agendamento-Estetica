import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { HERO_IMAGE } from "@/lib/site";
import { getSiteSettings } from "@/lib/site-settings-cache";
import { whatsappLink } from "@/lib/site-settings";
import { Brand } from "@/components/Brand";
import { EmptyState, LogoMark } from "@/components/ui";

function heroImageExists() {
  try {
    return fs.existsSync(path.join(process.cwd(), "public", HERO_IMAGE.src));
  } catch {
    return false;
  }
}

export default async function HomePage() {
  const session = await getSession();

  if (session?.user) {
    redirect(session.user.role === "ADMIN" ? "/admin" : "/meus-agendamentos");
  }

  const [services, site] = await Promise.all([
    prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    getSiteSettings(),
  ]);
  const whatsapp = whatsappLink(site.whatsapp);
  const hasPhoto = heroImageExists();

  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Brand />
        <nav aria-label="Conta" className="flex items-center gap-1">
          <Link href="/login" className="btn-ghost">
            Entrar
          </Link>
          <Link href="/cadastro" className="btn-secondary hidden sm:inline-flex">
            Criar conta
          </Link>
        </nav>
      </header>

      <main id="conteudo">
        {/* Abertura */}
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-blush blur-3xl" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 sm:px-6 md:grid-cols-2 md:pb-24 md:pt-14">
            <div>
              <p className="eyebrow">{site.tagline}</p>
              <div className="gold-rule mt-3" aria-hidden="true" />
              <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.1] text-plum sm:text-5xl lg:text-6xl">
                Um tempo para você, <em className="font-medium text-wine">do seu jeito</em>
              </h1>
              <p className="mt-5 max-w-md text-base leading-relaxed text-plum-muted sm:text-lg">
                {site.intro}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/agendar" className="btn-primary px-8 text-base">
                  Agendar horário
                </Link>
                <Link href="/cadastro" className="btn-secondary px-8 text-base">
                  Criar minha conta
                </Link>
              </div>
            </div>

            {/* Foto do trabalho (ou composição decorativa até haver uma imagem real) */}
            <div className="relative mx-auto w-full max-w-sm md:max-w-none">
              <div className="relative mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-t-[999px] rounded-b-3xl border border-gold/60 bg-blush shadow-lift">
                {hasPhoto ? (
                  <Image src={HERO_IMAGE.src} alt={HERO_IMAGE.alt} fill priority sizes="(min-width: 768px) 448px, 90vw" className="object-cover" />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-5 bg-gradient-to-b from-blush to-cream px-8 text-center" role="img" aria-label={`Ilustração decorativa do ${site.siteName}`}>
                    {site.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- logo própria do estúdio
                      <img src={site.logoUrl} alt="" className="h-28 w-28 rounded-full object-cover" />
                    ) : (
                      <LogoMark className="h-20 w-20" />
                    )}
                    <p className="font-display text-2xl italic text-wine">cuidado em cada detalhe</p>
                    <div className="gold-rule" aria-hidden="true" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Serviços */}
        <section aria-labelledby="servicos" className="bg-white/60 py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="eyebrow">Nossos serviços</p>
            <h2 id="servicos" className="mt-2 font-display text-3xl font-semibold text-plum sm:text-4xl">
              Escolha o seu momento
            </h2>
            <div className="gold-rule mt-4" aria-hidden="true" />

            {services.length === 0 ? (
              <div className="mt-8">
                <EmptyState title="Nossos serviços estarão aqui em breve">
                  Ainda não há serviços disponíveis para agendamento. Volte daqui a pouco.
                </EmptyState>
              </div>
            ) : (
              <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {services.map((service) => (
                  <li key={service.id} className="card flex flex-col justify-between gap-6">
                    <div>
                      <h3 className="font-display text-xl font-semibold text-plum">{service.name}</h3>
                      <p className="mt-1 text-sm text-plum-muted">{service.durationMinutes} minutos</p>
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <p className="font-display text-2xl font-semibold text-wine">{formatCents(service.priceCents)}</p>
                      <Link href={`/agendar/horario?serviceId=${service.id}`} className="btn-secondary" aria-label={`Selecionar ${service.name}`}>
                        Selecionar
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-blush-deep/50 px-4 py-8 text-center text-sm text-plum-muted">
        <p className="font-semibold text-plum">
          {site.siteName} · {site.tagline}
        </p>
        {(site.address || site.locationNotes) && (
          <p className="mx-auto mt-3 max-w-md">
            {site.address}
            {site.address && site.locationNotes ? " — " : ""}
            {site.locationNotes}
          </p>
        )}
        {(site.phone || whatsapp || site.instagramUrl) && (
          <p className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            {site.phone && (
              <a className="link" href={`tel:${site.phone.replace(/[^\d+]/g, "")}`}>
                Telefone: {site.phone}
              </a>
            )}
            {whatsapp && (
              <a className="link" href={whatsapp} target="_blank" rel="noopener noreferrer">
                WhatsApp: {site.whatsapp}
              </a>
            )}
            {site.instagramUrl && (
              <a className="link" href={site.instagramUrl} target="_blank" rel="noopener noreferrer">
                Instagram
              </a>
            )}
          </p>
        )}
      </footer>
    </>
  );
}
