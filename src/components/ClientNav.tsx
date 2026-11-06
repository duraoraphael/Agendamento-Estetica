"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Brand } from "@/components/Brand";
import { LinkPending } from "@/components/LinkPending";

export function ClientNav({ name }: { name: string }) {
  const pathname = usePathname();

  const linkClass = (active: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-wine focus-visible:ring-offset-2 focus-visible:ring-offset-cream ${
      active ? "bg-blush text-wine" : "text-plum-muted hover:bg-blush hover:text-plum"
    }`;

  return (
    <header className="sticky top-0 z-20 border-b border-blush-deep/50 bg-cream/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <Brand href="/meus-agendamentos" />
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-1">
          <Link href="/agendar" className={linkClass(pathname.startsWith("/agendar"))} aria-current={pathname.startsWith("/agendar") ? "page" : undefined}>
            Agendar
            <LinkPending />
          </Link>
          <Link
            href="/meus-agendamentos"
            className={linkClass(pathname.startsWith("/meus-agendamentos"))}
            aria-current={pathname.startsWith("/meus-agendamentos") ? "page" : undefined}
          >
            Meus agendamentos
            <LinkPending />
          </Link>
          <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="btn-ghost min-h-[44px]" title={`Sair (${name})`}>
            Sair
          </button>
        </nav>
      </div>
    </header>
  );
}
