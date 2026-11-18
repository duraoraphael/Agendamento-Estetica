import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, createService, createBooking, nextDayAt, uniquePlate } from "./helpers";
import { prisma } from "@/lib/db";
import { formatPlate, isValidPlate, maskPlate, normalizePlate } from "@/lib/plate";
import { notesSchema, plateSchema, vehicleSchema, LIMITS } from "@/lib/validation";
import { createVehicle, deleteVehicle, getVehicleForUser, listVehicles, parseVehicleForm, updateVehicle, VehicleError } from "@/lib/vehicles";

const input = (over: Record<string, unknown> = {}) => vehicleSchema.parse({ brand: "Fiat", model: "Argo", plate: "ABC1D23", ...over });

describe("Placas brasileiras", () => {
  it("normaliza (maiúsculas, sem separadores) e aceita os formatos antigo e Mercosul", () => {
    expect(normalizePlate("abc-1234")).toBe("ABC1234");
    expect(normalizePlate(" abc 1d23 ")).toBe("ABC1D23");
    expect(isValidPlate("ABC1234")).toBe(true); // antigo
    expect(isValidPlate("ABC1D23")).toBe(true); // Mercosul
    for (const bad of ["", "AB1234", "ABCD123", "ABC12345", "1BC1234", "ABC-1234", "ABC1D2", "ABC1D2'; DROP TABLE"]) {
      expect(isValidPlate(bad), bad).toBe(false);
    }
  });

  it("plateSchema devolve a forma normalizada e recusa entradas inválidas", () => {
    expect(plateSchema.parse("abc-1d23")).toBe("ABC1D23");
    expect(plateSchema.safeParse("abc-12").success).toBe(false);
    expect(plateSchema.safeParse("x".repeat(40)).success).toBe(false);
  });

  it("formata e mascara a placa para exibição", () => {
    expect(formatPlate("ABC1234")).toBe("ABC-1234");
    expect(formatPlate("ABC1D23")).toBe("ABC1D23");
    expect(maskPlate("ABC1D23")).toBe("ABC••23");
    expect(maskPlate("inválida")).not.toContain("inválida");
  });
});

describe("Validação do veículo e das observações (servidor)", () => {
  it("exige marca, modelo e placa; ano, cor e apelido são opcionais", () => {
    expect(vehicleSchema.safeParse({ brand: "", model: "Argo", plate: "ABC1D23" }).success).toBe(false);
    expect(vehicleSchema.safeParse({ brand: "Fiat", model: "", plate: "ABC1D23" }).success).toBe(false);
    const ok = input();
    expect(ok.year).toBeNull();
    expect(ok.color).toBeNull();
    expect(ok.nickname).toBeNull();
    expect(input({ year: "2021", color: " Preto ", nickname: "Daily" })).toMatchObject({ year: 2021, color: "Preto", nickname: "Daily" });
  });

  it("recusa ano impossível, textos longos e caracteres de controle ou de direção (bidi)", () => {
    expect(vehicleSchema.safeParse({ brand: "Fiat", model: "Argo", plate: "ABC1D23", year: "1850" }).success).toBe(false);
    expect(vehicleSchema.safeParse({ brand: "Fiat", model: "Argo", plate: "ABC1D23", year: "abc" }).success).toBe(false);
    expect(vehicleSchema.safeParse({ brand: "x".repeat(LIMITS.vehicleBrandMax + 1), model: "Argo", plate: "ABC1D23" }).success).toBe(false);
    expect(vehicleSchema.safeParse({ brand: "Fi\u0000at", model: "Argo", plate: "ABC1D23" }).success).toBe(false);
    expect(vehicleSchema.safeParse({ brand: "Fiat", model: "Ar‮go", plate: "ABC1D23" }).success).toBe(false);
  });

  it("não deixa passar campos extras (mass assignment): userId e id do formulário são descartados", () => {
    const parsed = vehicleSchema.parse({ brand: "Fiat", model: "Argo", plate: "ABC1D23", userId: "outra-pessoa", id: "x", role: "ADMIN" });
    expect(Object.keys(parsed).sort()).toEqual(["brand", "color", "model", "nickname", "plate", "year"]);
    const fd = new FormData();
    for (const [k, v] of Object.entries({ brand: "Fiat", model: "Argo", plate: "abc1d23", userId: "outra-pessoa" })) fd.set(k, v);
    const viaForm = parseVehicleForm(fd);
    expect(viaForm.success).toBe(true);
    expect(viaForm.success && Object.keys(viaForm.data)).not.toContain("userId");
  });

  it("observações: vazio vira nulo, até 500 caracteres, sem controles e quebras de linha preservadas", () => {
    expect(notesSchema.parse("")).toBeNull();
    expect(notesSchema.parse("   ")).toBeNull();
    expect(notesSchema.parse("Atenção nas rodas.\nObrigado")).toBe("Atenção nas rodas.\nObrigado");
    expect(notesSchema.safeParse("x".repeat(500)).success).toBe(true);
    expect(notesSchema.safeParse("x".repeat(501)).success).toBe(false);
    expect(notesSchema.safeParse("oi\u0000").success).toBe(false);
    // Texto com HTML é só texto: nada é interpretado (a tela escapa); aqui apenas não é alterado nem recusado.
    expect(notesSchema.parse("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});

describe("Veículos: propriedade, unicidade e histórico", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("cria, lista, edita e remove os próprios veículos", async () => {
    const c = await createClient();
    const v = await createVehicle(c.id, input());
    expect((await listVehicles(c.id)).map((x) => x.id)).toEqual([v.id]);
    const edited = await updateVehicle(c.id, v.id, input({ model: "Cronos", plate: "ZZZ9Z99" }));
    expect(edited).toMatchObject({ model: "Cronos", plate: "ZZZ9Z99" });
    await deleteVehicle(c.id, v.id);
    expect(await listVehicles(c.id)).toHaveLength(0);
  });

  it("IDOR: uma cliente não enxerga, edita nem remove veículo de outra (responde 'não encontrado')", async () => {
    const a = await createClient();
    const b = await createClient();
    const v = await createVehicle(a.id, input());
    expect(await getVehicleForUser(b.id, v.id)).toBeNull();
    await expect(updateVehicle(b.id, v.id, input({ model: "Invadido" }))).rejects.toThrow(VehicleError);
    await expect(deleteVehicle(b.id, v.id)).rejects.toThrow(VehicleError);
    const still = await prisma.vehicle.findUniqueOrThrow({ where: { id: v.id } });
    expect(still).toMatchObject({ userId: a.id, model: "Argo" });
    expect(await listVehicles(b.id)).toHaveLength(0);
  });

  it("a placa é única por dona (normalizada), mas duas donas podem ter a mesma", async () => {
    const a = await createClient();
    const b = await createClient();
    await createVehicle(a.id, input({ plate: "abc-1d23" }));
    await expect(createVehicle(a.id, input({ plate: "ABC1D23" }))).rejects.toThrow(/já cadastrou/);
    await expect(createVehicle(b.id, input({ plate: "ABC1D23" }))).resolves.toMatchObject({ plate: "ABC1D23" });
  });

  it("limita a quantidade de veículos por conta", async () => {
    const a = await createClient();
    for (let i = 0; i < LIMITS.vehiclesPerUserMax; i++) await createVehicle(a.id, input({ plate: uniquePlate() }));
    await expect(createVehicle(a.id, input({ plate: uniquePlate() }))).rejects.toThrow(/limite/);
  });

  it("o banco também recusa placa fora do formato (CHECK)", async () => {
    const a = await createClient();
    await expect(prisma.vehicle.create({ data: { userId: a.id, brand: "X", model: "Y", plate: "abc1234" } })).rejects.toThrow();
    await expect(prisma.vehicle.create({ data: { userId: a.id, brand: "X", model: "Y", plate: "ABC12" } })).rejects.toThrow();
  });

  it("editar ou remover o veículo NÃO altera o snapshot do agendamento já feito", async () => {
    const c = await createClient();
    const s = await createService();
    const v = await createVehicle(c.id, input({ brand: "Fiat", model: "Argo", plate: "ABC1D23" }));
    const appt = await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10, 0, 4), vehicleId: v.id });
    expect(appt).toMatchObject({ vehicleBrandSnapshot: "Fiat", vehicleModelSnapshot: "Argo", vehiclePlateSnapshot: "ABC1D23", vehicleId: v.id });

    await updateVehicle(c.id, v.id, input({ brand: "Jeep", model: "Compass", plate: "XYZ9Z99" }));
    let row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(row).toMatchObject({ vehicleBrandSnapshot: "Fiat", vehicleModelSnapshot: "Argo", vehiclePlateSnapshot: "ABC1D23" });

    await deleteVehicle(c.id, v.id);
    row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(row.vehicleId).toBeNull(); // o vínculo some, o histórico não
    expect(row).toMatchObject({ vehicleBrandSnapshot: "Fiat", vehicleModelSnapshot: "Argo", vehiclePlateSnapshot: "ABC1D23", serviceName: s.name });
  });
});
