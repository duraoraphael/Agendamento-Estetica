import type { ReactNode } from "react";
import Image from "next/image";
import { PHOTOS, type PhotoKey } from "@/lib/site";
import { SiteHeader } from "@/components/SiteHeader";

/**
 * Tela de autenticação dividida: formulário escuro à esquerda, fotografia à direita (desktop).
 * No celular o formulário vem PRIMEIRO e a foto vira uma faixa baixa depois dele.
 */
export function AuthShell({
  title,
  accent,
  subtitle,
  children,
  footer,
  photo = "hero",
}: {
  title?: string;
  accent: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
  photo?: PhotoKey;
}) {
  const img = PHOTOS[photo];
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      {/* Telas de acesso: a visitante ainda não entrou, então o cabeçalho é o público (cliente, sem consultar a sessão). */}
      <SiteHeader />
      <main id="conteudo" className="grid flex-1 md:grid-cols-2">
        <section className="flex items-start justify-center px-4 py-10 sm:px-8 md:items-center md:py-14">
          <div className="w-full max-w-md">
            <h1 className="page-title">
              {title ? `${title} ` : ""}
              <span className="accent">{accent}</span>
            </h1>
            <div className="accent-rule mt-3" aria-hidden="true" />
            <p className="mt-4 text-fg-muted">{subtitle}</p>
            <div className="mt-6">{children}</div>
            <div className="mt-6 text-sm text-fg-muted">{footer}</div>
          </div>
        </section>

        <aside aria-hidden="true" className="relative order-last h-44 overflow-hidden md:h-auto md:min-h-[560px] md:[clip-path:polygon(12%_0,100%_0,100%_100%,0_100%)]">
          <Image
            src={img.src}
            alt=""
            width={img.width}
            height={img.height}
            sizes="(min-width: 768px) 50vw, 100vw"
            // Foto panorâmica com o carro à direita: o foco fica ali (no centro mostraria só a garagem escura).
            className="absolute inset-0 h-full w-full object-cover object-[80%_center]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent md:bg-gradient-to-r md:from-ink/60" />
        </aside>
      </main>
    </div>
  );
}
