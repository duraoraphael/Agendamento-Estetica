import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings-cache";
import { ContactLinks } from "@/components/ContactLinks";
import { LocationDirections } from "@/components/LocationDirections";

/** Rodapé completo: nome, slogan, localização, contatos (telefone, WhatsApp, Instagram) e links do site. */
export async function SiteFooter() {
  const site = await getSiteSettings();

  return (
    <footer id="contato" className="border-t border-brand/70 bg-surface px-4 py-10 text-sm text-fg-muted sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-3">
        <div>
          <p className="font-display text-2xl font-extrabold uppercase italic text-fg">{site.siteName}</p>
          <p className="mt-2 max-w-xs">{site.tagline}</p>
        </div>

        <div>
          <h2 className="eyebrow !not-italic !normal-case !tracking-[0.18em] !font-bold !text-xs">Localização</h2>
          {site.address || site.locationNotes ? (
            <div className="mt-2">
              {site.address && <LocationDirections address={site.address} />}
              {site.locationNotes && <p className="mt-1 whitespace-pre-line break-words">{site.locationNotes}</p>}
            </div>
          ) : (
            <p className="mt-3">Endereço informado no momento do agendamento.</p>
          )}
        </div>

        <div>
          <h2 className="eyebrow !not-italic !normal-case !tracking-[0.18em] !font-bold !text-xs">Contato</h2>
          <ContactLinks site={site} className="mt-2" emptyMessage="Contatos disponíveis em breve." />
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p>© {new Date().getFullYear()} {site.siteName}. Todos os direitos reservados.</p>
        <nav aria-label="Rodapé" className="flex flex-wrap gap-4">
          <Link className="link" href="/servicos">
            Serviços
          </Link>
          <Link className="link" href="/agendar">
            Agendamento
          </Link>
          <Link className="link" href="/minha-conta">
            Minha conta
          </Link>
        </nav>
      </div>
    </footer>
  );
}
