"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Brand } from "@/components/Brand";
import { LinkPending } from "@/components/LinkPending";

const LINKS = [
  { href: "/admin", label: "Hoje" },
  { href: "/admin/agendamentos", label: "Agendamentos" },
  { href: "/admin/faturamento", label: "Faturamento" },
  { href: "/admin/servicos", label: "Serviços" },
  { href: "/admin/horarios", label: "Horários" },
  { href: "/admin/configuracoes", label: "Configurações" },
  { href: "/admin/configuracoes/google", label: "Google Agenda" },
  { href: "/admin/logs", label: "Logs" },
];

export function AdminNav({ adminName, newCount }: { adminName: string; newCount: number }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Brand href="/admin" />
          <span className="hidden rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-brand sm:inline">Painel</span>
        </div>
        <div className="flex items-center gap-1 sm:gap-3">
          {newCount > 0 && (
            <Link
              href="/admin/agendamentos"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-surface-2 px-3 text-xs font-semibold text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand" />
              {newCount} novo{newCount > 1 ? "s" : ""}
              <span className="sr-only"> agendamento{newCount > 1 ? "s" : ""}</span>
            </Link>
          )}
          <span className="hidden text-sm text-fg-muted md:inline">{adminName}</span>
          <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="btn-ghost">
            Sair
          </button>
        </div>
      </div>
      <nav aria-label="Painel" className="mx-auto max-w-6xl px-4 sm:px-6">
        <ul className="flex gap-1 overflow-x-auto py-2 text-sm">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <li key={link.href} className="flex-none">
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full px-4 font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    active ? "bg-brand text-ink" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  {link.label}
                  <LinkPending />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
