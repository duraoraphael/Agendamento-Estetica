/**
 * Identidade PADRÃO da Garage Zero Zero. Os valores reais vêm das Configurações do painel
 * (src/lib/site-settings.ts); estes aparecem enquanto a administração não os preencheu,
 * então instalações anteriores continuam funcionando sem nenhuma migração de dados.
 */
export const DEFAULT_SITE = {
  name: "Garage Zero Zero",
  tagline: "Estética automotiva premium, cuidado em cada detalhe",
  intro:
    "Lavagem detalhada, higienização interna, polimento e proteção de pintura. Escolha o serviço, o dia e o horário em poucos toques e deixe o seu carro com acabamento de vitrine.",
};

export const SITE_NAME = DEFAULT_SITE.name;
export const SITE_TAGLINE = DEFAULT_SITE.tagline;
export const SITE_DESCRIPTION =
  "Agende lavagem detalhada, higienização, polimento e proteção de pintura na Garage Zero Zero, estética automotiva premium.";

/** Logo oficial (arquivo fornecido pela proprietária; não redesenhar). A logo enviada nas Configurações tem prioridade. */
export const LOGO = { src: "/brand/logo.svg", width: 150, height: 150 } as const;

/**
 * Fotografias do site. Cada arquivo vive em `public/images/` (WebP). Para trocar uma foto, sobrescreva o arquivo com o
 * MESMO nome e as MESMAS proporções (veja docs/imagens.md): nenhum código precisa mudar. Largura e altura são as do
 * arquivo e evitam salto de layout.
 */
export const PHOTOS = {
  // Panorâmica (≈2,5:1), carro à direita e garagem escura à esquerda: abertura da home, telas de acesso e "confirmado".
  hero: { src: "/images/hero-carro.webp", width: 1983, height: 793, alt: "Cupê preto molhado em garagem escura com luzes amarelas" },
  lavagem: { src: "/images/lavagem-detalhada.webp", width: 1200, height: 800, alt: "Mão de luvas pretas lavando o farol de um carro preto com espuma amarela" },
  higienizacao: { src: "/images/higienizacao-interna.webp", width: 1200, height: 800, alt: "Higienização de banco de carro com extratora" },
  polimento: { src: "/images/polimento.webp", width: 1200, height: 800, alt: "Polimento da pintura preta com politriz orbital" },
  molhado: { src: "/images/carro-molhado.webp", width: 1000, height: 1400, alt: "Frente de um carro preto molhado em ambiente premium" },
  rodas: { src: "/images/detalhe-rodas.webp", width: 1200, height: 800, alt: "Detalhe da roda e da pinça de freio de um carro preto" },
  pintura: { src: "/images/detalhe-pintura.webp", width: 1200, height: 800, alt: "Reflexo na pintura preta recém-protegida" },
  interior: { src: "/images/detalhe-interior.webp", width: 1200, height: 800, alt: "Interior em couro preto com costuras amarelas" },
} as const;

export type PhotoKey = keyof typeof PHOTOS;
