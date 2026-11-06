/**
 * Paleta do site (única fonte de verdade). Consumida pelo Tailwind
 * (tailwind.config.ts) e pelos gráficos (BillingChart).
 *
 * Contrastes verificados (WCAG): wine sobre cream 7,5:1 · plum sobre cream 14:1 ·
 * muted sobre cream 6,5:1 · goldDeep sobre cream 6:1. O dourado `gold` tem
 * contraste baixo (2,8:1) e por isso é usado SOMENTE em detalhes decorativos —
 * texto dourado usa `goldDeep`.
 */
export const palette = {
  blush: { DEFAULT: "#F7E5EB", light: "#FCF1F5", deep: "#EBC9D6" },
  cream: { DEFAULT: "#FFF9F6", deep: "#F8EDE7" },
  wine: { DEFAULT: "#8B3157", dark: "#6F2545", darker: "#541B34" },
  plum: { DEFAULT: "#34232D", muted: "#6B5560", line: "#9A8591" },
  gold: { DEFAULT: "#B89160", soft: "#EAD8BE", deep: "#7A5A2E" },
  // Painel da manicure: fundo mais neutro.
  neutral: { page: "#F7F4F4", line: "#E7DFE2" },
  // Situações dos atendimentos (texto + fundo, todos ≥ 4,5:1).
  status: {
    confirmed: { fg: "#6F2545", bg: "#F7E5EB" },
    done: { fg: "#245C41", bg: "#E1F1E8" },
    cancelled: { fg: "#5B4A53", bg: "#ECE6E8" },
    noshow: { fg: "#7A4A0B", bg: "#FBEBD0" },
    danger: { fg: "#9B2C2C", bg: "#FBE9E9" },
  },
} as const;

/** Cores dos gráficos: série principal em vinho, secundária em dourado. */
export const chartColors = {
  primary: palette.wine.DEFAULT,
  secondary: palette.gold.DEFAULT,
  grid: "#EFE4E8",
  axis: palette.plum.muted,
};
