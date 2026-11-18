import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import { SiteProvider } from "@/components/SiteContext";
import { getSiteSettings } from "@/lib/site-settings-cache";
import { SITE_DESCRIPTION } from "@/lib/site";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
// Títulos: condensada, forte e esportiva. Itálico e pesos 700/800 são usados nos títulos principais.
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

// O nome, a logo e os contatos vêm das Configurações (banco). Renderização por requisição: nada de banco no build.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteSettings();
  return {
    title: { default: `${site.siteName} — Estética automotiva premium`, template: `%s · ${site.siteName}` },
    description: site.intro || SITE_DESCRIPTION,
    ...(site.logoUrl ? { icons: { icon: site.logoUrl } } : {}),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#090D10",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const site = await getSiteSettings();
  return (
    <html lang="pt-BR" className={`${sans.variable} ${display.variable}`}>
      <body>
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-5 focus:py-3 focus:text-sm focus:font-bold focus:text-ink"
        >
          Pular para o conteúdo
        </a>
        <SiteProvider site={{ name: site.siteName, logoUrl: site.logoUrl }}>{children}</SiteProvider>
      </body>
    </html>
  );
}
