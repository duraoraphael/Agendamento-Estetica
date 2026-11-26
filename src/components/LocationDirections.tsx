import { ChevronRightIcon, PinIcon } from "@/components/icons";

export function LocationDirections({ address }: { address: string }) {
  const destination = encodeURIComponent(address);
  const maps = [
    { name: "Google Maps", href: `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving` },
    { name: "Waze", href: `https://waze.com/ul?q=${destination}&navigate=yes` },
    { name: "Apple Maps", href: `https://maps.apple.com/directions?destination=${destination}&mode=driving` },
  ];

  return (
    <details className="group">
      <summary className="link flex min-h-[44px] w-fit max-w-full cursor-pointer list-none items-center gap-2 py-1 [&::-webkit-details-marker]:hidden">
        <PinIcon className="h-5 w-5 flex-none" />
        <span className="min-w-0 break-words">
          <span className="block">{address}</span>
          <span className="block text-xs font-semibold text-fg-muted">Abrir no GPS</span>
        </span>
        <ChevronRightIcon className="h-4 w-4 flex-none transition-transform group-open:rotate-90" />
      </summary>
      <ul aria-label="Aplicativos de GPS" className="mt-1 flex flex-wrap gap-x-3 pl-7">
        {maps.map(({ name, href }) => (
          <li key={name}>
            <a className="link inline-flex min-h-[44px] items-center" href={href} rel="noreferrer">
              {name}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
