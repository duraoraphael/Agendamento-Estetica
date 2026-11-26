import { describe, expect, it } from "vitest";
import { formatCents } from "@/lib/format";
import {
  VEHICLE_TYPES,
  VEHICLE_TYPE_LABELS,
  isVehicleType,
  lowestPrice,
  parseReaisToCents,
  priceLabel,
  resolvePrice,
  vehicleTypeLabel,
} from "@/lib/pricing";

describe("categorias de veículo", () => {
  it("são cinco, com rótulos em português", () => {
    expect([...VEHICLE_TYPES]).toEqual(["HATCH", "SEDA", "SUV", "PICAPE", "VAN"]);
    expect(VEHICLE_TYPE_LABELS).toEqual({ HATCH: "Hatch", SEDA: "Sedã", SUV: "SUV", PICAPE: "Picape", VAN: "Van/Utilitário" });
  });

  it("isVehicleType só aceita valores da lista", () => {
    expect(isVehicleType("SUV")).toBe(true);
    expect(isVehicleType("BARCO")).toBe(false);
    expect(isVehicleType(null)).toBe(false);
    expect(isVehicleType(undefined)).toBe(false);
    expect(isVehicleType("suv")).toBe(false);
  });
});

describe("vehicleTypeLabel (tipo gravado na reserva, no painel)", () => {
  it("devolve o rótulo de uma categoria válida e nulo para reserva antiga, vazio ou valor desconhecido", () => {
    expect(vehicleTypeLabel("SEDA")).toBe("Sedã");
    expect(vehicleTypeLabel("VAN")).toBe("Van/Utilitário");
    expect(vehicleTypeLabel(null)).toBeNull();
    expect(vehicleTypeLabel(undefined)).toBeNull();
    expect(vehicleTypeLabel("")).toBeNull();
    expect(vehicleTypeLabel("BARCO")).toBeNull();
  });
});

describe("resolvePrice", () => {
  it("chave desligada usa o preço padrão, mesmo com preço da categoria salvo", () => {
    expect(resolvePrice({ enabled: false, defaultCents: 5000, table: { SUV: 9000 }, vehicleType: "SUV" })).toEqual({ status: "ok", cents: 5000, source: "default" });
  });

  it("chave ligada usa o preço da categoria", () => {
    expect(resolvePrice({ enabled: true, defaultCents: 5000, table: { SUV: 9000 }, vehicleType: "SUV" })).toEqual({ status: "ok", cents: 9000, source: "type" });
  });

  it("categoria sem preço usa o padrão", () => {
    expect(resolvePrice({ enabled: true, defaultCents: 5000, table: { SUV: 9000 }, vehicleType: "SEDA" })).toEqual({ status: "ok", cents: 5000, source: "default" });
  });

  it("chave ligada com veículo sem tipo pede o tipo (nunca adivinha)", () => {
    expect(resolvePrice({ enabled: true, defaultCents: 5000, table: {}, vehicleType: null })).toEqual({ status: "needs-type" });
    expect(resolvePrice({ enabled: true, defaultCents: 5000, table: {}, vehicleType: undefined })).toEqual({ status: "needs-type" });
  });

  it("chave desligada com veículo sem tipo usa o padrão", () => {
    expect(resolvePrice({ enabled: false, defaultCents: 5000, table: {}, vehicleType: null })).toEqual({ status: "ok", cents: 5000, source: "default" });
  });

  it("tipo fora da lista nunca vira preço", () => {
    expect(resolvePrice({ enabled: true, defaultCents: 5000, table: { SUV: 9000 }, vehicleType: "BARCO" })).toEqual({ status: "needs-type" });
  });
});

describe("lowestPrice", () => {
  it("desligada: preço padrão, sem variação", () => {
    expect(lowestPrice({ enabled: false, defaultCents: 5000, table: { HATCH: 4000 } })).toEqual({ cents: 5000, varies: false });
  });

  it("ligada: menor preço aplicável, e o padrão cobre as categorias sem preço", () => {
    expect(lowestPrice({ enabled: true, defaultCents: 5000, table: { HATCH: 4000, SUV: 9000 } })).toEqual({ cents: 4000, varies: true });
  });

  it("ligada com preço específico maior que o padrão: o padrão (categorias sem preço) continua sendo o menor", () => {
    expect(lowestPrice({ enabled: true, defaultCents: 5000, table: { SUV: 9000 } })).toEqual({ cents: 5000, varies: true });
  });

  it("ligada com tabela vazia ou tudo igual: não varia", () => {
    expect(lowestPrice({ enabled: true, defaultCents: 5000, table: {} })).toEqual({ cents: 5000, varies: false });
    expect(lowestPrice({ enabled: true, defaultCents: 5000, table: { HATCH: 5000, SEDA: 5000, SUV: 5000, PICAPE: 5000, VAN: 5000 } })).toEqual({ cents: 5000, varies: false });
  });
});

describe("priceLabel", () => {
  it('ligada e variando: "A partir de" com o menor valor', () => {
    expect(priceLabel({ enabled: true, defaultCents: 5000, table: { HATCH: 4000, SUV: 9000 } })).toEqual({ text: formatCents(4000), prefix: "A partir de" });
  });

  it("desligada: valor padrão, sem prefixo", () => {
    expect(priceLabel({ enabled: false, defaultCents: 5000, table: { HATCH: 4000 } })).toEqual({ text: formatCents(5000), prefix: null });
  });
});

describe("parseReaisToCents", () => {
  it.each([
    ["40,00", 4000],
    ["40.5", 4050],
    ["40", 4000],
    [" 12,34 ", 1234],
    ["0", 0],
    // O teto é o mesmo do preço padrão do serviço (R$ 5.000,00): um zero a mais digitado sem querer não passa.
    ["5000", 500_000],
  ])("%s → %s", (raw, cents) => {
    expect(parseReaisToCents(raw)).toBe(cents);
  });

  it.each([[""], ["   "], ["-1"], ["abc"], ["5000,01"], ["45000"], ["1000000"], ["1e3"], ["4,0,0"]])("%j → null", (raw) => {
    expect(parseReaisToCents(raw)).toBeNull();
  });
});
