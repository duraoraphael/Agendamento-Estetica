/** Limites dos campos das Configurações. Arquivo sem dependências: a tela (navegador) e o servidor usam os mesmos valores. */
export const SETTINGS_LIMITS = {
  siteNameMax: 60,
  taglineMax: 120,
  introMax: 300,
  phoneMax: 20,
  addressMax: 200,
  locationNotesMax: 500,
} as const;
