import type { PhotoKey } from "./site";

/**
 * Catálogo de apresentação dos serviços automotivos: descrição, benefícios, ícone e foto. O banco guarda só nome, preço
 * e duração (a administração é dona desses valores); o que é texto de vitrine vem daqui, casando pelo nome normalizado.
 * Serviços com outro nome (cadastrados pela administração) usam o texto genérico `FALLBACK_INFO`.
 */
export type IconName = "car" | "seat" | "polisher" | "sparkles" | "shield" | "wind" | "drop";

export interface ServiceInfo {
  icon: IconName;
  photo: PhotoKey;
  description: string;
  benefits: string[];
}

/** Serviços cadastrados por padrão (seed e script de migração). Preço em centavos e duração em minutos são PONTO DE PARTIDA. */
export const DEFAULT_SERVICES = [
  { name: "Lavagem detalhada", priceCents: 12000, durationMinutes: 120 },
  { name: "Higienização interna", priceCents: 28000, durationMinutes: 180 },
  { name: "Polimento técnico", priceCents: 45000, durationMinutes: 240 },
  { name: "Cristalização de pintura", priceCents: 60000, durationMinutes: 240 },
  { name: "Vitrificação", priceCents: 120000, durationMinutes: 300 },
  { name: "Higienização de ar-condicionado", priceCents: 15000, durationMinutes: 60 },
  { name: "Limpeza e hidratação de couro", priceCents: 32000, durationMinutes: 150 },
] as const;

/** Nomes EXATOS dos serviços de demonstração do sistema antigo (manicure). Só estes são desativados pela migração. */
export const LEGACY_DEMO_SERVICE_NAMES = [
  "Manicure tradicional",
  "Pedicure tradicional",
  "Manicure + Pedicure",
  "Esmaltação em gel",
  "Alongamento de unhas",
] as const;

/** Textos padrão do sistema antigo. Só configurações que ainda estão EXATAMENTE assim são trocadas pela migração. */
export const LEGACY_SITE_DEFAULTS = {
  siteName: "Studio de Manicure",
  tagline: "Unhas delicadas, atendimento sem pressa",
  intro: "Manicure, pedicure e esmaltação em um espaço acolhedor. Escolha o serviço, o dia e o horário em poucos toques, de onde estiver.",
} as const;

export const FALLBACK_INFO: ServiceInfo = {
  icon: "sparkles",
  photo: "pintura",
  description: "Serviço de estética automotiva feito com produtos profissionais e atenção a cada detalhe do seu veículo.",
  benefits: ["Produtos profissionais", "Equipe especializada", "Acabamento de vitrine"],
};

const CATALOG: Record<string, ServiceInfo> = {
  "lavagem detalhada": {
    icon: "car",
    photo: "lavagem",
    description: "Lavagem completa com shampoo neutro, descontaminação leve, rodas, caixas de roda e secagem sem riscos.",
    benefits: ["Remove sujeira entranhada", "Não agride a pintura", "Rodas e caixas de roda limpas"],
  },
  "higienizacao interna": {
    icon: "seat",
    photo: "higienizacao",
    description: "Limpeza profunda de bancos, carpetes, teto e painéis com extratora e aspiração técnica.",
    benefits: ["Elimina manchas e odores", "Bancos e carpetes renovados", "Ambiente mais saudável"],
  },
  "polimento tecnico": {
    icon: "polisher",
    photo: "polimento",
    description: "Correção de riscos leves e marcas de lavagem com politriz orbital, devolvendo brilho e profundidade à pintura.",
    benefits: ["Reduz riscos e marcas", "Brilho profundo", "Prepara a pintura para proteção"],
  },
  "cristalizacao de pintura": {
    icon: "sparkles",
    photo: "pintura",
    description: "Camada de proteção que realça o brilho e facilita a limpeza, indicada para manutenção periódica da pintura.",
    benefits: ["Brilho intenso", "Água escorre com facilidade", "Proteção contra sol e chuva"],
  },
  vitrificacao: {
    icon: "shield",
    photo: "pintura",
    description: "Proteção cerâmica de longa duração, com dureza e repelência superiores, aplicada sobre pintura corrigida.",
    benefits: ["Proteção de longa duração", "Alta repelência a água e sujeira", "Pintura mais dura e brilhante"],
  },
  "higienizacao de ar-condicionado": {
    icon: "wind",
    photo: "interior",
    description: "Limpeza do sistema de ar-condicionado e do filtro de cabine para eliminar odores, fungos e bactérias.",
    benefits: ["Ar mais limpo", "Fim do cheiro de mofo", "Melhor desempenho do ar"],
  },
  "limpeza e hidratacao de couro": {
    icon: "drop",
    photo: "interior",
    description: "Limpeza específica e hidratação dos bancos em couro, preservando a maciez e evitando ressecamento.",
    benefits: ["Couro macio e hidratado", "Previne rachaduras", "Remove oleosidade"],
  },
};

/** Minúsculas, sem acentos e sem espaços repetidos: casa "Higienização Interna" com "higienizacao interna". */
export function normalizeServiceName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function getServiceInfo(name: string): ServiceInfo {
  return CATALOG[normalizeServiceName(name)] ?? FALLBACK_INFO;
}
