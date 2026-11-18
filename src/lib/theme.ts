/**
 * Design system da Garage Zero Zero (única fonte de verdade). Consumido pelo Tailwind
 * (tailwind.config.ts) e pelos gráficos (BillingChart).
 *
 * Tema escuro com amarelo estratégico: o amarelo `brand` aparece em CTAs, estados selecionados, linhas decorativas,
 * bordas de destaque, ícones e palavras-chave dos títulos. NUNCA como fundo de áreas grandes.
 *
 * Contrastes (WCAG AA, calculados sobre `ink` #090D10):
 *  - fg #F5F0DF 16:1 · fg-muted #B9BEC1 10:1 · brand #FFCA05 13:1 (texto e ícones sobre fundo escuro);
 *  - texto PRETO (#090D10) sobre brand 13:1 (botões e selecionados);
 *  - status: cada par texto/fundo abaixo tem ≥ 7:1.
 */
export const palette = {
  ink: { DEFAULT: "#090D10" }, // fundo principal
  surface: { DEFAULT: "#11171B", 2: "#171E22" }, // fundo elevado e superfície secundária
  brand: { DEFAULT: "#FFCA05", hover: "#E9B800" },
  fg: { DEFAULT: "#F5F0DF", muted: "#B9BEC1", white: "#FFFFFF" },
  // Bordas: `DEFAULT` discreta (divisórias), `strong` para campos de formulário (contraste ≥ 3:1 com o fundo).
  line: { DEFAULT: "#2A3237", strong: "#6B777E" },
  // Situações dos atendimentos (texto + fundo).
  status: {
    confirmed: { fg: "#7EE2A8", bg: "#12301F" },
    done: { fg: "#F5F0DF", bg: "#2A3237" },
    cancelled: { fg: "#B9BEC1", bg: "#1D2428" },
    // Aviso: amarelo com texto preto.
    noshow: { fg: "#090D10", bg: "#FFCA05" },
    danger: { fg: "#FF9B9B", bg: "#3A1616", solid: "#C62828" },
  },
} as const;

/** Cores dos gráficos: série principal amarela, apoio em cinza/off-white, fundo escuro. */
export const chartColors = {
  primary: palette.brand.DEFAULT,
  secondary: palette.fg.muted,
  grid: "#2A3237",
  axis: palette.fg.muted,
  tooltipBg: palette.surface.DEFAULT,
  tooltipText: palette.fg.DEFAULT,
};
