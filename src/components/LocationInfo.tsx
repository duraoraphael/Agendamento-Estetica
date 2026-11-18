import { whatsappLink, type SiteSettingsView } from "@/lib/site-settings";

/** Onde fica a empresa e como falar com ele (endereço, instruções de chegada, telefone/WhatsApp). Oculto se nada foi preenchido. */
export function LocationInfo({ site, className = "" }: { site: SiteSettingsView; className?: string }) {
  const wa = whatsappLink(site.whatsapp);
  if (!site.address && !site.locationNotes && !site.phone && !wa) return null;
  return (
    <section aria-label="Local do atendimento" className={`rounded-2xl border border-brand/40 bg-surface px-5 py-4 text-sm ${className}`}>
      <p className="font-semibold text-fg">{site.siteName}</p>
      {site.address && <p className="mt-1 text-fg">{site.address}</p>}
      {site.locationNotes && <p className="mt-1 whitespace-pre-line text-fg-muted">{site.locationNotes}</p>}
      {(site.phone || wa) && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {site.phone && (
            <a className="link" href={`tel:${site.phone.replace(/[^\d+]/g, "")}`}>
              Telefone: {site.phone}
            </a>
          )}
          {wa && (
            <a className="link" href={wa} target="_blank" rel="noopener noreferrer">
              WhatsApp: {site.whatsapp}
            </a>
          )}
        </p>
      )}
    </section>
  );
}
