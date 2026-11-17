import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, openAllWeek, createService, dateKeyDaysAhead } from "./helpers";
import { prisma } from "@/lib/db";
import { RATE_LIMITS } from "@/lib/constants";
import { hitLimit, limitKey } from "@/lib/rate-limit";

// Sessão simulada (o limitador e o banco são reais).
let sessionUserId = "u-busca";
vi.mock("@/lib/session", () => ({
  requireClient: async () => ({ id: sessionUserId, role: "CLIENTE", name: "Cliente" }),
}));

// Conta quantos dias a busca realmente examina (cada um = consulta ao banco + possível chamada ao Google).
vi.mock("@/lib/availability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/availability")>();
  return { ...actual, generateSlotCandidatesForDate: vi.fn(actual.generateSlotCandidatesForDate) };
});

const BUDGET = RATE_LIMITS.nextDayLookupsPerMinute;
const searchKey = (userId: string) => limitKey("slots-search-user", userId);

async function consume(userId: string, units: number) {
  for (let i = 0; i < units; i++) await hitLimit(searchKey(userId), BUDGET, 60_000);
}

describe("Busca do próximo dia livre: orçamento por dia examinado (achado 4)", () => {
  let serviceId: string;
  let examined: ReturnType<typeof vi.fn>;
  let findNextAvailableDayAction: typeof import("@/app/agendar/actions").findNextAvailableDayAction;

  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
    serviceId = (await createService({ durationMinutes: 30 })).id;
    sessionUserId = `u-${Math.random().toString(36).slice(2)}`;
    ({ findNextAvailableDayAction } = await import("@/app/agendar/actions"));
    examined = (await import("@/lib/availability")).generateSlotCandidatesForDate as unknown as ReturnType<typeof vi.fn>;
    examined.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  /** Bloqueia todos os dias das próximas semanas: a busca precisa olhar os 21 dias e não acha nada. */
  async function blockEverything() {
    await prisma.blockedPeriod.create({
      data: { startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 120 * 86_400_000), reason: "teste" },
    });
  }

  it("acha o próximo dia logo no primeiro dia examinado e cobra só 1 unidade", async () => {
    const r = await findNextAvailableDayAction(serviceId, dateKeyDaysAhead(0));
    expect(r).toEqual({ dateKey: dateKeyDaysAhead(1) });
    expect(examined).toHaveBeenCalledTimes(1);
    expect((await prisma.rateLimit.findUnique({ where: { key: searchKey(sessionUserId) } }))?.count).toBe(1);
  });

  it("nenhum horário nos 21 dias: devolve { dateKey: null } (NÃO é limite), examinando e cobrando 21 dias", async () => {
    await blockEverything();
    const r = await findNextAvailableDayAction(serviceId, dateKeyDaysAhead(0));
    expect(r).toEqual({ dateKey: null });
    expect(examined).toHaveBeenCalledTimes(21);
    expect((await prisma.rateLimit.findUnique({ where: { key: searchKey(sessionUserId) } }))?.count).toBe(21);
  });

  it("saldo parcial: para no dia em que o orçamento acaba e devolve um estado DISTINTO de 'sem horários'", async () => {
    await blockEverything();
    await consume(sessionUserId, BUDGET - 9); // sobram 9 unidades
    const r = await findNextAvailableDayAction(serviceId, dateKeyDaysAhead(0));

    expect(r).toEqual({ error: "Muitas consultas seguidas. Aguarde um instante e tente novamente.", rateLimited: true });
    expect(examined).toHaveBeenCalledTimes(9); // exatamente o saldo; o 10º dia nem chegou a ser examinado
    expect(r).not.toHaveProperty("dateKey");
  });

  it("saldo esgotado: nenhum dia é examinado", async () => {
    await blockEverything();
    await consume(sessionUserId, BUDGET);
    const r = await findNextAvailableDayAction(serviceId, dateKeyDaysAhead(0));
    expect(r).toMatchObject({ rateLimited: true });
    expect(examined).not.toHaveBeenCalled();
  });

  it("o saldo é verificado ANTES de cada dia: depois de acabar, uma nova chamada não faz trabalho algum", async () => {
    await blockEverything();
    await findNextAvailableDayAction(serviceId, dateKeyDaysAhead(0)); // 21
    await findNextAvailableDayAction(serviceId, dateKeyDaysAhead(0)); // 42
    examined.mockClear();
    const third = await findNextAvailableDayAction(serviceId, dateKeyDaysAhead(0));
    expect(third).toMatchObject({ rateLimited: true });
    expect(examined).not.toHaveBeenCalled();
  });

  it("concorrência: 5 buscas simultâneas da mesma cliente dividem UM saldo (trabalho total ≤ orçamento)", async () => {
    await blockEverything();
    const results = await Promise.all(Array.from({ length: 5 }, () => findNextAvailableDayAction(serviceId, dateKeyDaysAhead(0))));
    expect(examined.mock.calls.length).toBeLessThanOrEqual(BUDGET);
    expect(examined.mock.calls.length).toBeGreaterThan(21);
    expect(results.filter((r) => "rateLimited" in r).length).toBeGreaterThanOrEqual(2);
  });

  it("o orçamento é por cliente: outra cliente não é afetada", async () => {
    await blockEverything();
    await consume(sessionUserId, BUDGET);
    sessionUserId = `outra-${Math.random().toString(36).slice(2)}`;
    expect(await findNextAvailableDayAction(serviceId, dateKeyDaysAhead(0))).toEqual({ dateKey: null });
  });

  it("limite geral de consultas (60/min) também é sinalizado como rateLimited", async () => {
    for (let i = 0; i < RATE_LIMITS.slotsPerMinute; i++) await hitLimit(limitKey("slots-user", sessionUserId), RATE_LIMITS.slotsPerMinute, 60_000);
    const r = await findNextAvailableDayAction(serviceId, dateKeyDaysAhead(0));
    expect(r).toMatchObject({ rateLimited: true });
    expect(examined).not.toHaveBeenCalled();
  });

  it("data inválida e serviço inexistente continuam recusados, sem gastar o orçamento da busca", async () => {
    expect(await findNextAvailableDayAction(serviceId, "2026-02-30")).toEqual({ error: "Data inválida." });
    expect(await findNextAvailableDayAction("nao-existe", dateKeyDaysAhead(0))).toEqual({ error: "Esse serviço não está mais disponível." });
    expect(examined).not.toHaveBeenCalled();
    expect(await prisma.rateLimit.findUnique({ where: { key: searchKey(sessionUserId) } })).toBeNull();
  });
});
