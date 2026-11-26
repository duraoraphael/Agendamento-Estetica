import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, createClient, createService, createVehicleFor, setPricing, setServicePrices } from "./helpers";
import { resolveBookingVehicle } from "@/lib/booking-vehicle";

/**
 * As etapas "horário" e "revisão" só abrem com um veículo DA CLIENTE (e, com a cobrança por tipo ligada, com tipo
 * definido). O ID vem da URL e nunca é confiável: veículo de outra cliente, apagado ou inventado responde "não".
 */
describe("resolveBookingVehicle (veículo e preço das etapas de horário e revisão)", () => {
  beforeEach(resetDb);

  async function setup() {
    const client = await createClient();
    const service = await createService({ priceCents: 5000 });
    await setServicePrices(service.id, { SUV: 9000 });
    return { client, service };
  }

  it("veículo próprio, chave ligada: devolve o veículo e o preço da categoria", async () => {
    const { client, service } = await setup();
    await setPricing({ enabled: true });
    const vehicle = await createVehicleFor(client.id, { vehicleType: "SUV" });
    const result = await resolveBookingVehicle(client.id, vehicle.id, service);
    expect(result).toMatchObject({ ok: true, price: { cents: 9000, source: "type" } });
    expect(result.ok && result.vehicle.id).toBe(vehicle.id);
  });

  it("chave desligada: o preço padrão, e veículo antigo sem tipo é aceito", async () => {
    const { client, service } = await setup();
    const legacy = await createVehicleFor(client.id, { vehicleType: null });
    expect(await resolveBookingVehicle(client.id, legacy.id, service)).toMatchObject({ ok: true, price: { cents: 5000, source: "default" } });
  });

  it("chave ligada e veículo sem tipo: não segue (a etapa de veículo pede o tipo)", async () => {
    const { client, service } = await setup();
    await setPricing({ enabled: true });
    const legacy = await createVehicleFor(client.id, { vehicleType: null });
    expect(await resolveBookingVehicle(client.id, legacy.id, service)).toEqual({ ok: false, reason: "needs-type" });
  });

  it("veículo de OUTRA cliente, inexistente, vazio ou ausente: 'não encontrado', sem revelar nada", async () => {
    const { client, service } = await setup();
    const other = await createClient();
    const foreign = await createVehicleFor(other.id, { vehicleType: "SUV" });
    for (const id of [foreign.id, "nao-existe", "", undefined, "x".repeat(500)]) {
      expect(await resolveBookingVehicle(client.id, id, service)).toEqual({ ok: false, reason: "not-found" });
    }
  });

  it("veículo apagado depois de escolhido: 'não encontrado'", async () => {
    const { client, service } = await setup();
    const vehicle = await createVehicleFor(client.id, { vehicleType: "SUV" });
    const { prisma } = await import("@/lib/db");
    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    expect(await resolveBookingVehicle(client.id, vehicle.id, service)).toEqual({ ok: false, reason: "not-found" });
  });
});
