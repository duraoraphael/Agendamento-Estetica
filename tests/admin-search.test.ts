import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, createService, createVehicleFor, createBooking, nextDayAt, dateKeyDaysAhead } from "./helpers";
import { buildSearchFilter, cleanSearchQuery, listAppointmentsPage, ADMIN_SEARCH_MAX_LENGTH } from "@/lib/admin-appointments";

describe("Painel: busca por cliente e por placa", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  async function populate() {
    const maria = await createClient({ name: "Maria Souza" });
    const joao = await createClient({ name: "João Pereira" });
    const s = await createService();
    await createBooking({ clientId: maria.id, serviceId: s.id, startAt: nextDayAt(9, 0, 2), vehicleId: (await createVehicleFor(maria.id, { plate: "ABC1D23" })).id });
    await createBooking({ clientId: joao.id, serviceId: s.id, startAt: nextDayAt(11, 0, 2), vehicleId: (await createVehicleFor(joao.id, { plate: "XYZ9876" })).id });
  }

  const range = () => ({ fromKey: dateKeyDaysAhead(0), toKey: dateKeyDaysAhead(10), page: 1 });
  const find = async (query: string) => (await listAppointmentsPage({ ...range(), query })).items.map((a) => a.client.name);

  it("sem busca lista tudo; por nome (sem diferenciar maiúsculas) e por placa (normalizada, parcial)", async () => {
    await populate();
    expect((await listAppointmentsPage(range())).total).toBe(2);
    expect(await find("maria")).toEqual(["Maria Souza"]);
    expect(await find("PEREIRA")).toEqual(["João Pereira"]);
    expect(await find("abc1d23")).toEqual(["Maria Souza"]);
    expect(await find("xyz-98")).toEqual(["João Pereira"]);
    expect(await find("abc-1d")).toEqual(["Maria Souza"]);
    expect(await find("ninguem")).toEqual([]);
  });

  it("o resultado exibe veículo e placa do agendamento", async () => {
    await populate();
    const [row] = (await listAppointmentsPage({ ...range(), query: "ABC1D23" })).items;
    expect(row).toMatchObject({ vehicleBrandSnapshot: "Fiat", vehicleModelSnapshot: "Argo", vehiclePlateSnapshot: "ABC1D23" });
  });

  it("combina com o filtro de período (fora do período não aparece)", async () => {
    await populate();
    const none = await listAppointmentsPage({ fromKey: dateKeyDaysAhead(5), toKey: dateKeyDaysAhead(6), page: 1, query: "maria" });
    expect(none.total).toBe(0);
  });

  it("texto malicioso ou gigante não quebra nem vaza: é tratado como texto e limitado", async () => {
    await populate();
    for (const evil of ["' OR 1=1 --", "%", "_", "\\", "a".repeat(5000), "ABC\u0000"]) {
      await expect(listAppointmentsPage({ ...range(), query: evil })).resolves.toBeDefined();
    }
    expect(await find("' OR 1=1 --")).toEqual([]);
    expect(cleanSearchQuery("a".repeat(5000))).toHaveLength(ADMIN_SEARCH_MAX_LENGTH);
    expect(cleanSearchQuery("  oi\u0000 mundo  ")).toBe("oi mundo");
    expect(buildSearchFilter("")).toEqual({});
    expect(buildSearchFilter("-")).toHaveProperty("OR"); // só por nome: "-" não vira fragmento de placa
    expect((buildSearchFilter("-") as { OR: unknown[] }).OR).toHaveLength(1);
  });
});
