import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, createClient, createService } from "./helpers";
import { prisma } from "@/lib/db";
import { zonedToUtc } from "@/lib/format";
import {
  ADMIN_LIST_MAX_RANGE_DAYS,
  ADMIN_LIST_PAGE_SIZE,
  addDaysToDateKey,
  listAppointmentsPage,
  parsePageNumber,
  resolveDateRange,
} from "@/lib/admin-appointments";

const TODAY = "2026-12-10";

describe("Listagem do painel: intervalo (achado 10)", () => {
  it("sem datas: o padrão é só o dia de hoje (fuso de São Paulo, chave já local)", () => {
    expect(resolveDateRange(undefined, undefined, TODAY)).toEqual({ fromKey: TODAY, toKey: TODAY, clamped: false });
  });

  it("datas inválidas ou impossíveis caem no padrão em vez de virar `Invalid Date`", () => {
    expect(resolveDateRange("2026-02-30", "lixo", TODAY)).toEqual({ fromKey: TODAY, toKey: TODAY, clamped: false });
    expect(resolveDateRange("1999-01-01", "2101-01-01", TODAY)).toEqual({ fromKey: TODAY, toKey: TODAY, clamped: false });
    expect(resolveDateRange("2026-13-01", undefined, TODAY).fromKey).toBe(TODAY);
  });

  it("só `from`: o fim acompanha o início; só `to` anterior a hoje: o fim sobe para o início", () => {
    expect(resolveDateRange("2026-12-20", undefined, TODAY)).toEqual({ fromKey: "2026-12-20", toKey: "2026-12-20", clamped: false });
    expect(resolveDateRange(undefined, "2026-12-01", TODAY)).toEqual({ fromKey: TODAY, toKey: TODAY, clamped: false });
  });

  it("intervalo invertido (to < from) vira um único dia", () => {
    expect(resolveDateRange("2026-12-20", "2026-12-01", TODAY)).toEqual({ fromKey: "2026-12-20", toKey: "2026-12-20", clamped: false });
  });

  it(`o máximo é ${ADMIN_LIST_MAX_RANGE_DAYS} dias contando os dois extremos`, () => {
    const lastOk = addDaysToDateKey("2026-12-01", ADMIN_LIST_MAX_RANGE_DAYS - 1);
    expect(resolveDateRange("2026-12-01", lastOk, TODAY)).toEqual({ fromKey: "2026-12-01", toKey: lastOk, clamped: false });

    const tooFar = addDaysToDateKey("2026-12-01", ADMIN_LIST_MAX_RANGE_DAYS);
    expect(resolveDateRange("2026-12-01", tooFar, TODAY)).toEqual({ fromKey: "2026-12-01", toKey: lastOk, clamped: true });
  });

  it("o caso do achado (2000-01-01 até 2100-12-31) é recuado para o máximo", () => {
    const r = resolveDateRange("2000-01-01", "2100-12-31", TODAY);
    expect(r.clamped).toBe(true);
    expect(r.fromKey).toBe("2000-01-01");
    expect(r.toKey).toBe(addDaysToDateKey("2000-01-01", ADMIN_LIST_MAX_RANGE_DAYS - 1));
  });

  it("aritmética de dias atravessa mês, ano e bissexto", () => {
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("número de página: só inteiros positivos; o resto vira 1", () => {
    for (const bad of [undefined, "", "abc", "-1", "0", "1.5", "1e3", " 2", "9999999999"]) expect(parsePageNumber(bad)).toBe(1);
    expect(parsePageNumber("1")).toBe(1);
    expect(parsePageNumber("7")).toBe(7);
  });
});

describe("Listagem do painel: consulta paginada no banco (achado 10)", () => {
  let clientId: string;
  let serviceId: string;

  // Duração de 1 minuto: no PostgreSQL a restrição Appointment_no_overlap recusa reservas ativas sobrepostas
  // (intervalo semiaberto [início, fim)), então as fixtures usam horários distintos. Empates de horário, que só
  // existem em situações que não ocupam a agenda, usam CANCELADA.
  async function seed(rows: Array<{ startAt: Date; status?: string }>) {
    await prisma.appointment.createMany({
      data: rows.map((r) => ({
        clientId,
        serviceId,
        serviceName: "Manicure",
        priceCents: 4000,
        durationMinutes: 1,
        startAt: r.startAt,
        endAt: new Date(r.startAt.getTime() + 60_000),
        status: r.status ?? "CONFIRMADA",
      })),
    });
  }
  const at = (day: number, hour: number, minute = 0) => zonedToUtc(2026, 12, day, hour, minute);

  beforeEach(async () => {
    await resetDb();
    clientId = (await createClient()).id;
    serviceId = (await createService()).id;
  });

  it(`pagina em ${ADMIN_LIST_PAGE_SIZE} por página e nenhuma linha repete ou some, mesmo com horários idênticos`, async () => {
    // 60 reservas no MESMO instante: só o desempate por id mantém a ordem estável entre páginas.
    await seed(Array.from({ length: 60 }, () => ({ startAt: at(10, 9), status: "CANCELADA" })));
    const params = { fromKey: "2026-12-10", toKey: "2026-12-10" };

    const p1 = await listAppointmentsPage({ ...params, page: 1 });
    const p2 = await listAppointmentsPage({ ...params, page: 2 });
    const p3 = await listAppointmentsPage({ ...params, page: 3 });

    expect([p1.total, p1.pageCount]).toEqual([60, 3]);
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([ADMIN_LIST_PAGE_SIZE, ADMIN_LIST_PAGE_SIZE, 10]);
    const ids = [...p1.items, ...p2.items, ...p3.items].map((a) => a.id);
    expect(new Set(ids).size).toBe(60);
    expect(ids).toEqual([...ids].sort()); // empate no horário -> ordem por id
  });

  it("ordena por horário e página além da última devolve a última (nunca vazia por engano)", async () => {
    await seed([{ startAt: at(10, 15) }, { startAt: at(10, 9) }, { startAt: at(10, 11) }]);
    const r = await listAppointmentsPage({ fromKey: "2026-12-10", toKey: "2026-12-10", page: 99 });
    expect(r.page).toBe(1);
    expect(r.items.map((a) => a.startAt.getTime())).toEqual([at(10, 9), at(10, 11), at(10, 15)].map((d) => d.getTime()));
  });

  it("limites do dia seguem o fuso de São Paulo: 23:59 do último dia entra, 00:00 do dia seguinte não", async () => {
    await seed([
      { startAt: at(9, 23, 59) }, // antes do início
      { startAt: at(10, 0, 0) }, // primeiro instante do intervalo
      { startAt: at(11, 23, 59) }, // último instante do intervalo
      { startAt: at(12, 0, 0) }, // já fora
    ]);
    const r = await listAppointmentsPage({ fromKey: "2026-12-10", toKey: "2026-12-11", page: 1 });
    expect(r.total).toBe(2);
    expect(r.items.map((a) => a.startAt.getTime())).toEqual([at(10, 0, 0).getTime(), at(11, 23, 59).getTime()]);
  });

  it("o filtro de situação continua valendo e entra na contagem", async () => {
    await seed([{ startAt: at(10, 9) }, { startAt: at(10, 10), status: "CANCELADA" }, { startAt: at(10, 11), status: "CANCELADA" }]);
    const r = await listAppointmentsPage({ fromKey: "2026-12-10", toKey: "2026-12-10", status: "CANCELADA", page: 1 });
    expect(r.total).toBe(2);
    expect(r.items.every((a) => a.status === "CANCELADA")).toBe(true);
  });

  it("intervalo sem reservas: página 1 de 1, vazia", async () => {
    const r = await listAppointmentsPage({ fromKey: "2026-12-10", toKey: "2026-12-10", page: 1 });
    expect(r).toMatchObject({ total: 0, page: 1, pageCount: 1, items: [] });
  });

  it("só carrega a página pedida (o painel não traz o histórico inteiro)", async () => {
    await seed(Array.from({ length: 30 }, (_, i) => ({ startAt: at(1 + (i % 28), 9, Math.floor(i / 28)) })));
    const r = await listAppointmentsPage({ fromKey: "2026-12-01", toKey: "2026-12-28", page: 1 });
    expect(r.items.length).toBeLessThanOrEqual(ADMIN_LIST_PAGE_SIZE);
    expect(r.total).toBe(30);
  });
});
