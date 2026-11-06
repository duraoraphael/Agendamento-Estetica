"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_SITE } from "@/lib/site";

/** Identidade visível em qualquer tela (cabeçalhos, login). Preenchida pelo layout raiz a partir das Configurações. */
export interface SiteIdentity {
  name: string;
  logoUrl: string | null;
}

const SiteContext = createContext<SiteIdentity>({ name: DEFAULT_SITE.name, logoUrl: null });

export function SiteProvider({ site, children }: { site: SiteIdentity; children: ReactNode }) {
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteIdentity {
  return useContext(SiteContext);
}
