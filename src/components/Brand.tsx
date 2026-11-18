"use client";

import Image from "next/image";
import Link from "next/link";
import { useSite } from "@/components/SiteContext";
import { LOGO } from "@/lib/site";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

/**
 * Marca no cabeçalho: SÓ a logo circular (como nas referências). Usa a logo enviada nas Configurações, se houver; senão o
 * arquivo oficial. O nome fica disponível para leitores de tela.
 */
export function Brand({ href = "/", size = "md" }: { href?: string; size?: "md" | "lg" }) {
  const { name, logoUrl } = useSite();
  const box = size === "lg" ? "h-20 w-20" : "h-14 w-14";
  return (
    <Link href={href} className={`inline-flex items-center rounded-full ${focusRing}`}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagem própria, já limitada a 512 KB; o <Image> exigiria configurar o otimizador.
        <img src={logoUrl} alt="" width={80} height={80} className={`${box} flex-none rounded-full border-2 border-brand/70 object-cover`} />
      ) : (
        <Image src={LOGO.src} alt="" width={LOGO.width} height={LOGO.height} unoptimized priority className={`${box} flex-none rounded-full border-2 border-brand/70 object-cover`} />
      )}
      <span className="sr-only">{name} — página inicial</span>
    </Link>
  );
}
