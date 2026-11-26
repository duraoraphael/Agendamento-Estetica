import { whatsappLink, type SiteSettingsView } from "@/lib/site-settings";
import { ContactLinks } from "@/components/ContactLinks";
import { LocationDirections } from "@/components/LocationDirections";

/** Endereço, instruções de chegada e contatos da empresa. */
export function LocationInfo({ site, className = "" }: { site: SiteSettingsView; className?: string }) {
  if (!site.address && !site.locationNotes && !site.phone && !whatsappLink(site.whatsapp) && !site.instagramUrl) return null;
  return (
    <section aria-label="Local do atendimento" className={`rounded-2xl border border-brand/40 bg-surface px-5 py-4 text-sm ${className}`}>
      <p className="font-semibold text-fg">{site.siteName}</p>
      {site.address && <LocationDirections address={site.address} />}
      {site.locationNotes && <p className="mt-1 whitespace-pre-line text-fg-muted">{site.locationNotes}</p>}
      <ContactLinks site={site} className="mt-1 flex flex-wrap gap-x-4" />
    </section>
  );
}
