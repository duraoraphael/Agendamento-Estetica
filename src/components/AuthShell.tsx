import type { ReactNode } from "react";
import { Brand } from "@/components/Brand";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-blush-light to-cream">
      <header className="px-4 py-5 sm:px-6">
        <Brand />
      </header>
      <main id="conteudo" className="flex flex-1 items-start justify-center px-4 pb-14 pt-4 sm:items-center">
        <div className="w-full max-w-md">
          <div className="text-center">
            <h1 className="font-display text-3xl font-semibold text-plum sm:text-4xl">{title}</h1>
            <div className="gold-rule mx-auto mt-3" aria-hidden="true" />
            <p className="mt-3 text-sm text-plum-muted">{subtitle}</p>
          </div>
          <div className="card mt-6 p-6 sm:p-8">{children}</div>
          <p className="mt-5 text-center text-sm text-plum-muted">{footer}</p>
        </div>
      </main>
    </div>
  );
}
