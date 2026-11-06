/**
 * Identidade PADRÃO do estúdio. Os valores reais vêm das Configurações do painel
 * (src/lib/site-settings.ts); estes aparecem enquanto a administradora não os preencheu,
 * então instalações anteriores continuam funcionando sem nenhuma migração de dados.
 */
export const DEFAULT_SITE = {
  name: "Studio de Manicure",
  tagline: "Unhas delicadas, atendimento sem pressa",
  intro: "Manicure, pedicure e esmaltação em um espaço acolhedor. Escolha o serviço, o dia e o horário em poucos toques, de onde estiver.",
};

export const SITE_NAME = DEFAULT_SITE.name;
export const SITE_TAGLINE = DEFAULT_SITE.tagline;
export const SITE_DESCRIPTION = "Agende seu horário de manicure e pedicure em poucos toques.";

/**
 * Foto do trabalho exibida na abertura da página inicial.
 * Coloque o arquivo em `public/images/` (ex.: `public/images/hero.jpg`) e ajuste
 * o caminho abaixo. Enquanto o arquivo não existir, a abertura usa uma
 * composição tipográfica no lugar da foto.
 */
export const HERO_IMAGE = {
  src: "/images/hero.jpg",
  alt: "Mãos com unhas esmaltadas em tons suaves, trabalho do estúdio",
};
