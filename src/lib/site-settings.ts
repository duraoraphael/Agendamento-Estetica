import { z } from "zod";
import { prisma } from "./db";
import { DEFAULT_SITE } from "./site";
import { validateLogo, type ValidLogo } from "./logo-image";
import type { Db } from "./prisma-types";

/** Valores já resolvidos (com os padrões aplicados) que o site inteiro consome. */
export interface SiteSettingsView {
  siteName: string;
  tagline: string;
  intro: string;
  phone: string;
  whatsapp: string;
  address: string;
  locationNotes: string;
  instagramUrl: string;
  /** URL da logo enviada (com versão para cache), ou null para usar a marca padrão. */
  logoUrl: string | null;
}

import { SETTINGS_LIMITS } from "./site-limits";
export { SETTINGS_LIMITS };

const phoneRegex = /^\(?\d{2}\)?[\s-]?\d{4,5}-?\d{4}$/;
// Sem caracteres de controle (exceto quebra de linha nos campos de texto longo).
const noControl = (v: string) => {
  for (const ch of v) {
    const c = ch.codePointAt(0) ?? 0;
    // controles C0/DEL, separadores de linha Unicode e marcas de direção (bidi) usadas em "Trojan Source"
    if (c < 32 || c === 127 || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return false;
  }
  return true;
};

/** Aceita "@usuario", "usuario" ou o link do Instagram; devolve sempre `https://www.instagram.com/<usuario>` ou "". */
export function normalizeInstagram(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "";
  let handle = value;
  if (/^[a-z]+:\/\//i.test(value) || /^(www\.)?instagram\.com\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!/^(www\.)?instagram\.com$/i.test(url.hostname)) return null;
    handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
  }
  handle = handle.replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return null;
  return `https://www.instagram.com/${handle}`;
}

/** Link de conversa do WhatsApp (assume Brasil quando o número não traz o código do país). */
export function whatsappLink(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const full = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
  return `https://wa.me/${full}`;
}

const optionalText = (max: number, label: string, multiline = false) =>
  z
    .string()
    .trim()
    .max(max, `${label}: no máximo ${max} caracteres.`)
    .refine((v) => (multiline ? noControl(v.replace(/[\r\n]/g, " ")) : noControl(v)), `${label}: contém caracteres inválidos.`);

const optionalPhone = (label: string) =>
  z
    .string()
    .trim()
    .max(SETTINGS_LIMITS.phoneMax, `${label}: número longo demais.`)
    .refine((v) => v === "" || phoneRegex.test(v), `${label}: informe o número com DDD, ex: (11) 90000-0000.`);

export const siteSettingsSchema = z.object({
  siteName: optionalText(SETTINGS_LIMITS.siteNameMax, "Nome").refine((v) => v.length >= 2, "Informe o nome da empresa (mínimo 2 caracteres)."),
  tagline: optionalText(SETTINGS_LIMITS.taglineMax, "Slogan"),
  intro: optionalText(SETTINGS_LIMITS.introMax, "Apresentação", true),
  phone: optionalPhone("Telefone"),
  whatsapp: optionalPhone("WhatsApp"),
  address: optionalText(SETTINGS_LIMITS.addressMax, "Endereço"),
  locationNotes: optionalText(SETTINGS_LIMITS.locationNotesMax, "Instruções de chegada", true),
  instagramUrl: z
    .string()
    .trim()
    .max(200, "Instagram: link longo demais.")
    .transform((v, ctx) => {
      const n = normalizeInstagram(v);
      if (n === null) {
        ctx.addIssue({ code: "custom", message: "Instagram: informe o @usuario ou o link do perfil (instagram.com/usuario)." });
        return z.NEVER;
      }
      return n;
    }),
});

export type SiteSettingsInput = z.infer<typeof siteSettingsSchema>;

type Row = {
  siteName: string; tagline: string; intro: string; phone: string; whatsapp: string;
  address: string; locationNotes: string; instagramUrl: string; logoVersion: number;
} | null;

/** Mescla o que está no banco com os padrões: campo vazio de identidade usa o padrão; contatos vazios ficam ocultos. */
export function resolveSettings(row: Row): SiteSettingsView {
  return {
    siteName: row?.siteName || DEFAULT_SITE.name,
    tagline: row?.tagline || DEFAULT_SITE.tagline,
    intro: row?.intro || DEFAULT_SITE.intro,
    phone: row?.phone ?? "",
    whatsapp: row?.whatsapp ?? "",
    address: row?.address ?? "",
    locationNotes: row?.locationNotes ?? "",
    instagramUrl: row?.instagramUrl ?? "",
    logoUrl: row && row.logoVersion > 0 ? `/api/logo?v=${row.logoVersion}` : null,
  };
}

/** Leitura direta do banco (sem cache). O site usa `getSiteSettings` (site-settings-cache.ts). */
export async function loadSiteSettings(db: Db = prisma): Promise<SiteSettingsView> {
  const row = await db.siteSettings.findUnique({ where: { id: 1 } });
  return resolveSettings(row);
}

export type LogoChange = { kind: "keep" } | { kind: "remove" } | { kind: "replace"; logo: ValidLogo };

/** Grava as configurações (e a logo, na mesma transação). `input` já foi validado por `siteSettingsSchema`. */
export async function saveSiteSettings(input: SiteSettingsInput, logo: LogoChange): Promise<SiteSettingsView> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.siteSettings.findUnique({ where: { id: 1 }, select: { logoVersion: true } });
    let logoVersion = current?.logoVersion ?? 0;

    if (logo.kind === "replace") {
      const data = Buffer.from(logo.logo.bytes);
      await tx.siteLogo.upsert({
        where: { id: 1 },
        create: { id: 1, contentType: logo.logo.contentType, data, width: logo.logo.width, height: logo.logo.height },
        update: { contentType: logo.logo.contentType, data, width: logo.logo.width, height: logo.logo.height },
      });
      // O contador nunca volta atrás: a URL da logo é cacheada por 1 ano (`?v=`), então reutilizar um número
      // faria navegadores que já guardaram a logo antiga continuarem mostrando-a.
      logoVersion = Math.abs(logoVersion) + 1;
    } else if (logo.kind === "remove") {
      await tx.siteLogo.deleteMany({ where: { id: 1 } });
      // Negativo = "sem logo", preservando o contador para a próxima troca (resolveSettings só usa versões > 0).
      logoVersion = -Math.abs(logoVersion);
    }

    await tx.siteSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...input, logoVersion },
      update: { ...input, logoVersion },
    });
  });
  return loadSiteSettings();
}

/** Valida os bytes recebidos de um upload (reexporta a validação para quem só importa deste módulo). */
export { validateLogo };
