import type { Vehicle } from "@prisma/client";
import { loadPriceByTypeEnabled, loadPriceTables, priceFor } from "./pricing-data";
import type { PriceResolution } from "./pricing";
import { getVehicleForUser } from "./vehicles";
import { idSchema } from "./validation";

export type ResolvedBookingVehicle =
  | { ok: true; vehicle: Vehicle; price: Extract<PriceResolution, { status: "ok" }> }
  | { ok: false; reason: "not-found" | "needs-type" };

/**
 * Veículo e preço das etapas "data e horário" e "revisão". O ID do veículo vem da URL e NUNCA é confiável: só vale se
 * for da própria cliente (veículo de outra pessoa, apagado ou inventado responde igual: "not-found", sem revelar nada).
 * Com a cobrança por tipo ligada, veículo sem tipo devolve "needs-type": a etapa de veículo pede para completar.
 * O preço sai do mesmo cálculo que `createBooking` repete, sob o lock, na hora de confirmar.
 */
export async function resolveBookingVehicle(
  userId: string,
  vehicleId: string | undefined,
  service: { id: string; priceCents: number }
): Promise<ResolvedBookingVehicle> {
  if (!vehicleId || !idSchema.safeParse(vehicleId).success) return { ok: false, reason: "not-found" };
  const vehicle = await getVehicleForUser(userId, vehicleId);
  if (!vehicle) return { ok: false, reason: "not-found" };

  const [enabled, tables] = await Promise.all([loadPriceByTypeEnabled(), loadPriceTables([service.id])]);
  const price = priceFor(service, vehicle.vehicleType, { enabled, tables });
  if (price.status === "needs-type") return { ok: false, reason: "needs-type" };
  return { ok: true, vehicle, price };
}
