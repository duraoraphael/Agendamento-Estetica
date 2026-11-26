import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createAdmin, createClient, createService, createVehicleFor, setPricing, setServicePrices, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { createBooking, rescheduleOwnBooking, BookingValidationError } from "@/lib/booking";
import { loadPriceByTypeEnabled, loadPriceTables, priceFor, saveServicePrices, setPriceByTypeEnabled } from "@/lib/pricing-data";

const TYPE_REQUIRED = /Informe o tipo do seu veículo/;
const PRICE_CHANGED = /O valor deste serviço mudou/;

describe("Preço da reserva calculado no servidor", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  async function scenario(opts: { enabled: boolean; table?: Record<string, number>; vehicleType: "HATCH" | "SEDA" | "SUV" | "PICAPE" | "VAN" | null }) {
    const client = await createClient();
    const service = await createService({ priceCents: 5000, durationMinutes: 60 });
    await setPricing({ enabled: opts.enabled });
    await setServicePrices(service.id, opts.table ?? { SUV: 9000 });
    const vehicle = await createVehicleFor(client.id, { vehicleType: opts.vehicleType });
    return { client, service, vehicle, startAt: nextDayAt(10, 0, 4) };
  }

  it("chave desligada: preço padrão, mesmo com preço da categoria salvo", async () => {
    const { client, service, vehicle, startAt } = await scenario({ enabled: false, vehicleType: "SUV" });
    const appt = await createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: vehicle.id });
    expect(appt).toMatchObject({ priceCents: 5000, vehicleTypeSnapshot: "SUV" });
  });

  it("chave ligada: preço da categoria do veículo, gravado junto com o tipo", async () => {
    const { client, service, vehicle, startAt } = await scenario({ enabled: true, vehicleType: "SUV" });
    const appt = await createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: vehicle.id });
    expect(appt).toMatchObject({ priceCents: 9000, vehicleTypeSnapshot: "SUV" });
  });

  it("chave ligada e categoria sem preço: usa o preço padrão", async () => {
    const { client, service, vehicle, startAt } = await scenario({ enabled: true, vehicleType: "SEDA" });
    const appt = await createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: vehicle.id });
    expect(appt).toMatchObject({ priceCents: 5000, vehicleTypeSnapshot: "SEDA" });
  });

  it("chave ligada e veículo antigo sem tipo: recusa pedindo o tipo, sem criar reserva", async () => {
    const { client, service, vehicle, startAt } = await scenario({ enabled: true, vehicleType: null });
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: vehicle.id })).rejects.toThrow(TYPE_REQUIRED);
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: vehicle.id })).rejects.toBeInstanceOf(BookingValidationError);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it("chave desligada e veículo antigo sem tipo: reserva normal pelo preço padrão", async () => {
    const { client, service, vehicle, startAt } = await scenario({ enabled: false, vehicleType: null });
    const appt = await createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: vehicle.id });
    expect(appt).toMatchObject({ priceCents: 5000, vehicleTypeSnapshot: null });
  });

  it("expectedPriceCents diferente do calculado: recusa e não grava nada; igual: cria", async () => {
    const { client, service, vehicle, startAt } = await scenario({ enabled: true, vehicleType: "SUV" });
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: vehicle.id, expectedPriceCents: 5000 })).rejects.toThrow(PRICE_CHANGED);
    expect(await prisma.appointment.count()).toBe(0);
    const appt = await createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: vehicle.id, expectedPriceCents: 9000 });
    expect(appt.priceCents).toBe(9000);
  });

  it("o administrador muda a tabela entre a revisão e a confirmação: o valor antigo nunca é gravado", async () => {
    const { client, service, vehicle, startAt } = await scenario({ enabled: true, vehicleType: "SUV" });
    const seenInReview = 9000;
    await setServicePrices(service.id, { SUV: 11_000 });
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: vehicle.id, expectedPriceCents: seenInReview })).rejects.toThrow(PRICE_CHANGED);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it("veículo de OUTRA cliente com a chave ligada continua sendo recusado", async () => {
    const { client, service, startAt } = await scenario({ enabled: true, vehicleType: "SUV" });
    const other = await createClient();
    const foreign = await createVehicleFor(other.id, { vehicleType: "SUV" });
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: foreign.id })).rejects.toBeInstanceOf(BookingValidationError);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it("o preço histórico não muda quando a tabela muda ou a chave é desligada, nem ao reagendar", async () => {
    const { client, service, vehicle, startAt } = await scenario({ enabled: true, vehicleType: "SUV" });
    const appt = await createBooking({ clientId: client.id, serviceId: service.id, startAt, vehicleId: vehicle.id });
    expect(appt.priceCents).toBe(9000);

    await setServicePrices(service.id, { SUV: 12_000 });
    await setPricing({ enabled: false });
    await prisma.service.update({ where: { id: service.id }, data: { priceCents: 7000 } });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).priceCents).toBe(9000);

    const moved = await rescheduleOwnBooking({ appointmentId: appt.id, clientId: client.id, newStartAt: nextDayAt(14, 0, 5) });
    expect(moved).toMatchObject({ priceCents: 9000, vehicleTypeSnapshot: "SUV" });
  });
});

describe("Leitura e gravação da configuração de preços", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sem linha em SiteSettings a chave está desligada", async () => {
    expect(await loadPriceByTypeEnabled()).toBe(false);
  });

  it("setPriceByTypeEnabled liga e desliga, e registra na auditoria quem fez", async () => {
    const admin = await createAdmin();
    await setPriceByTypeEnabled(true, admin.id);
    expect(await loadPriceByTypeEnabled()).toBe(true);
    await setPriceByTypeEnabled(false, admin.id);
    expect(await loadPriceByTypeEnabled()).toBe(false);
    const logs = await prisma.auditLog.findMany({ where: { action: "pricing_mode_changed" }, orderBy: { occurredAt: "asc" } });
    expect(logs.map((l) => [l.actorId, l.detail])).toEqual([
      [admin.id, "Ligado"],
      [admin.id, "Desligado"],
    ]);
  });

  it("saveServicePrices grava, atualiza e remove as categorias que saíram da tabela", async () => {
    const s = await createService();
    await prisma.$transaction((tx) => saveServicePrices(tx, s.id, { SUV: 9000, HATCH: 4000 }));
    expect((await loadPriceTables([s.id])).get(s.id)).toEqual({ SUV: 9000, HATCH: 4000 });
    await prisma.$transaction((tx) => saveServicePrices(tx, s.id, { SUV: 9500 }));
    expect((await loadPriceTables([s.id])).get(s.id)).toEqual({ SUV: 9500 });
    await prisma.$transaction((tx) => saveServicePrices(tx, s.id, {}));
    expect(await prisma.servicePrice.count()).toBe(0);
  });

  it("loadPriceTables devolve uma tabela (vazia) para cada serviço pedido", async () => {
    const a = await createService({ name: "A" });
    const b = await createService({ name: "B" });
    await setServicePrices(a.id, { PICAPE: 8000 });
    const tables = await loadPriceTables([a.id, b.id]);
    expect(tables.get(a.id)).toEqual({ PICAPE: 8000 });
    expect(tables.get(b.id)).toEqual({});
  });

  it("priceFor aplica a regra de preço com a chave e as tabelas carregadas", async () => {
    const tables = new Map([["s1", { SUV: 9000 }]]);
    const service = { id: "s1", priceCents: 5000 };
    expect(priceFor(service, "SUV", { enabled: true, tables })).toEqual({ status: "ok", cents: 9000, source: "type" });
    expect(priceFor(service, "SUV", { enabled: false, tables })).toEqual({ status: "ok", cents: 5000, source: "default" });
    expect(priceFor(service, null, { enabled: true, tables })).toEqual({ status: "needs-type" });
    expect(priceFor({ id: "outro", priceCents: 3000 }, "SUV", { enabled: true, tables })).toEqual({ status: "ok", cents: 3000, source: "default" });
  });
});
