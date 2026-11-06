"use client";

import Link from "next/link";
import { LogoMark } from "@/components/ui";
import { useSite } from "@/components/SiteContext";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine focus-visible:ring-offset-2 focus-visible:ring-offset-cream";

/** Marca do estúdio no cabeçalho: logo enviada nas Configurações (ou a gota padrão) + nome. */
export function Brand({ href = "/", size = "md" }: { href?: string; size?: "md" | "lg" }) {
  const { name, logoUrl } = useSite();
  const box = size === "lg" ? "h-14 w-14" : "h-9 w-9";
  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 rounded-full ${focusRing}`}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagem própria, já limitada a 512 KB; o <Image> exigiria configurar o otimizador.
        <img src={logoUrl} alt="" className={`${box} flex-none rounded-full object-cover`} />
      ) : (
        <LogoMark className={box} />
      )}
      <span className="font-display text-lg font-semibold leading-none text-plum">{name}</span>
    </Link>
  );
}
