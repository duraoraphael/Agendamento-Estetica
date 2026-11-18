"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Brand } from "@/components/Brand";
import { CloseIcon, MenuIcon } from "@/components/icons";

/**
 * Cabeçalho único do site (público e área da cliente): logo, "Serviços", "Agendamento", "Minha conta" e o CTA
 * "Agendar agora". No celular os links ficam num menu que abre por botão (teclado: Esc fecha e devolve o foco).
 * Administradoras veem "Painel" no lugar de "Minha conta".
 */
export function SiteHeader({ signedIn = false, role = null }: { signedIn?: boolean; role?: "CLIENTE" | "ADMIN" | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Fecha o menu ao trocar de página e com a tecla Esc.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const isAdmin = role === "ADMIN";
  const links = [
    { href: "/servicos", label: "Serviços", active: pathname.startsWith("/servicos") },
    { href: "/agendar", label: "Agendamento", active: pathname.startsWith("/agendar") },
    isAdmin
      ? { href: "/admin", label: "Painel", active: pathname.startsWith("/admin") }
      : { href: "/minha-conta", label: "Minha conta", active: pathname.startsWith("/minha-conta") || pathname.startsWith("/meus-agendamentos") },
  ];

  const linkClass = (active: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
      active ? "text-brand" : "text-fg hover:text-brand"
    }`;

  return (
    <header className="relative z-30 border-b border-brand/70 bg-ink">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
        <Brand href="/" />

        <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(l.active)} aria-current={l.active ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
          <Link href="/agendar" className="btn-primary ml-2 min-h-[44px] px-5 py-2">
            Agendar agora
          </Link>
          {signedIn && (
            <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="btn-ghost ml-1">
              Sair
            </button>
          )}
        </nav>

        <button
          ref={buttonRef}
          type="button"
          className="btn-secondary h-11 w-11 min-h-[44px] px-0 md:hidden"
          aria-expanded={open}
          aria-controls="menu-principal"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {open && (
        <nav id="menu-principal" aria-label="Menu principal" className="absolute inset-x-0 top-full border-b border-brand/70 bg-ink px-4 pb-4 md:hidden">
          <ul className="mx-auto flex max-w-6xl flex-col gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={`${linkClass(l.active)} w-full`} aria-current={l.active ? "page" : undefined}>
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="pt-2">
              <Link href="/agendar" className="btn-primary w-full">
                Agendar agora
              </Link>
            </li>
            {signedIn && (
              <li>
                <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="btn-ghost w-full">
                  Sair
                </button>
              </li>
            )}
          </ul>
        </nav>
      )}
    </header>
  );
}
