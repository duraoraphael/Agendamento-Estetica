import { formatCents } from "./format";
import { LIMITS } from "./limits";

/**
 * Regras de preço por tipo de veículo. Módulo PURO (sem banco, sem sessão): é usado no servidor para decidir o preço
 * e nas telas para mostrar o valor. A leitura da chave e da tabela de preços fica em `pricing-data.ts`.
 */

export const VEHICLE_TYPES = ["HATCH", "SEDA", "SUV", "PICAPE", "VAN"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  HATCH: "Hatch",
  SEDA: "Sedã",
  SUV: "SUV",
  PICAPE: "Picape",
  VAN: "Van/Utilitário",
};

export function isVehicleType(value: unknown): value is VehicleType {
  return typeof value === "string" && (VEHICLE_TYPES as readonly string[]).includes(value);
}

/** Rótulo da categoria gravada (ex.: "Sedã"), ou nulo para reserva antiga, vazio ou valor desconhecido. */
export function vehicleTypeLabel(value: string | null | undefined): string | null {
  return isVehicleType(value) ? VEHICLE_TYPE_LABELS[value] : null;
}

/** Preço específico por categoria, em centavos. Categoria ausente = usa o preço padrão do serviço. */
export type PriceTable = Partial<Record<VehicleType, number>>;

export type PriceResolution = { status: "ok"; cents: number; source: "default" | "type" } | { status: "needs-type" };

interface PricingInput {
  enabled: boolean;
  defaultCents: number;
  table: PriceTable;
}

/**
 * Preço de um serviço para um veículo. Chave desligada: sempre o preço padrão. Chave ligada: o da categoria, ou o
 * padrão se a categoria não tem preço; sem categoria válida não há como decidir, então pede o tipo (nunca adivinha).
 */
export function resolvePrice(o: PricingInput & { vehicleType: string | null | undefined }): PriceResolution {
  if (!o.enabled) return { status: "ok", cents: o.defaultCents, source: "default" };
  if (!isVehicleType(o.vehicleType)) return { status: "needs-type" };
  const specific = o.table[o.vehicleType];
  return specific === undefined ? { status: "ok", cents: o.defaultCents, source: "default" } : { status: "ok", cents: specific, source: "type" };
}

/** Menor preço aplicável entre as categorias (a sem preço específico entra com o padrão) e se o preço varia. */
export function lowestPrice(o: PricingInput): { cents: number; varies: boolean } {
  if (!o.enabled) return { cents: o.defaultCents, varies: false };
  const effective = VEHICLE_TYPES.map((t) => o.table[t] ?? o.defaultCents);
  return { cents: Math.min(...effective), varies: new Set(effective).size > 1 };
}

/** Texto para a vitrine: "A partir de" só quando o preço varia por tipo. */
export function priceLabel(o: PricingInput): { text: string; prefix: string | null } {
  const { cents, varies } = lowestPrice(o);
  return { text: formatCents(cents), prefix: varies ? "A partir de" : null };
}

/** "40,00", "40.5" ou "40" (reais) → centavos. `null` se vazio, negativo, não numérico ou acima do teto do preço de um serviço. */
export function parseReaisToCents(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(value)) return null;
  const cents = Math.round(Number(value.replace(",", ".")) * 100);
  // Mesmo teto do preço padrão do serviço (R$ 5.000,00): um zero a mais digitado sem querer não vira preço.
  return cents <= LIMITS.priceCentsMax ? cents : null;
}
