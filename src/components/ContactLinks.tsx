import { InstagramIcon, PhoneIcon, WhatsAppIcon } from "@/components/icons";
import { normalizeInstagram, whatsappLink, type SiteSettingsView } from "@/lib/site-settings";

export function ContactLinks({
  site,
  className,
  emptyMessage,
}: {
  site: Pick<SiteSettingsView, "phone" | "whatsapp" | "instagramUrl">;
  className: string;
  emptyMessage?: string;
}) {
  const phone = site.phone.replace(/[^\d+]/g, "");
  const links = [
    { label: `Telefone: ${site.phone}`, href: phone ? `tel:${phone}` : null, Icon: PhoneIcon, color: "text-brand" },
    { label: `WhatsApp: ${site.whatsapp}`, href: whatsappLink(site.whatsapp), Icon: WhatsAppIcon, color: "text-[#25d366]" },
    { label: "Instagram", href: normalizeInstagram(site.instagramUrl), Icon: InstagramIcon, color: "text-[#f17bb2]" },
  ];

  if (!links.some(({ href }) => href)) {
    return emptyMessage ? <p className={className}>{emptyMessage}</p> : null;
  }

  return (
    <ul className={`flex flex-wrap items-center gap-2 ${className}`}>
      {links.map(({ label, href, Icon, color }) => {
        if (!href) return null;
        const external = href.startsWith("https:");
        return (
          <li key={label}>
            {/* Só o ícone na tela; o nome (e o número) fica para leitores de tela e na dica ao passar o mouse. */}
            <a
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong transition hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              href={href}
              aria-label={label}
              title={label}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
            >
              <Icon className={`h-6 w-6 flex-none ${color}`} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
