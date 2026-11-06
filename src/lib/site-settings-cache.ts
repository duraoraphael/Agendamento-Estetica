import { cache } from "react";
import { unstable_cache, revalidateTag } from "next/cache";
import { loadSiteSettings, type SiteSettingsView } from "./site-settings";

export const SITE_SETTINGS_TAG = "site-settings";

/**
 * Configurações do site para páginas e layouts.
 *
 *  - Escopo: GLOBAL (nome, contatos e logo do estúdio são públicos; nada aqui é de usuário).
 *  - Chave: fixa ("site-settings"); uma só linha no banco.
 *  - Invalidação: `invalidateSiteSettings()` na ação de salvar (revalidateTag), então a alteração
 *    aparece na hora; sem isso, no máximo 5 minutos (rede de segurança).
 *  - `cache` do React deduplica as várias chamadas (layout + página) dentro da mesma requisição.
 */
const cached = unstable_cache(() => loadSiteSettings(), ["site-settings-v1"], { tags: [SITE_SETTINGS_TAG], revalidate: 300 });

export const getSiteSettings = cache(async (): Promise<SiteSettingsView> => cached());

export function invalidateSiteSettings() {
  revalidateTag(SITE_SETTINGS_TAG);
}
