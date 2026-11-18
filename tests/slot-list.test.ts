import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { resetDb, createClient, createService, createAdmin, nextDayAt, dateKeyDaysAhead } from "./helpers";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { __setCalendarFactoryForTests, clearFreeBusyCache } from "@/lib/google-calendar";
import { createBooking } from "./helpers";
import { makeFakeCalendar } from "./fake-calendar";

// As ações exigem sessão de cliente; o resto (banco, limitador, regras de horário) é real.
let sessionUserId = "u-slots";
vi.mock("@/lib/session", () => ({
  requireClient: async () => ({ id: sessionUserId, role: "CLIENTE", name: "Cliente" }),
}));

const hhmm = (iso: string) => formatInTimeZone(new Date(iso), "America/Sao_Paulo", "HH:mm");

async function openWeekdays() {
  for (let day = 0; day <= 6; day++) {
    await prisma.businessHours.create({ data: { dayOfWeek: day, active: true, startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" } });
  }
}

describe("Lista de horários da cliente: só o que realmente cabe", () => {
  beforeEach(async () => {
    await resetDb();
    await openWeekdays();
    sessionUserId = (await createClient()).id;
  });
  afterEach(() => {
    __setCalendarFactoryForTests(null);
    clearFreeBusyCache();
    vi.restoreAllMocks();
  });

  it("atendimento das 14h às 15h: serviço de 1 h some às 13h30, 14h e 14h30; 13h e 15h continuam na lista", async () => {
    const { getAvailableSlotsAction } = await import("@/app/agendar/actions");
    const other = await createClient();
    const service = await createService({ durationMinutes: 60 });
    await createBooking({ clientId: other.id, serviceId: service.id, startAt: nextDayAt(14, 0, 2) });

    const r = await getAvailableSlotsAction(service.id, dateKeyDaysAhead(2));
    if ("error" in r) throw new Error(r.error);
    const times = r.slots.map(hhmm);
    for (const taken of ["13:30", "14:00", "14:30"]) expect(times).not.toContain(taken);
    for (const free of ["13:00", "15:00", "15:15"]) expect(times).toContain(free);
    // Almoço (12h–13h) e fim do expediente: 17h é o último início possível para 1 h.
    expect(times).not.toContain("12:00");
    expect(times).not.toContain("11:15");
    expect(times).toContain("11:00");
    expect(times.at(-1)).toBe("17:00");
    // Nada de “indisponíveis” na resposta: a lista só tem o que pode ser escolhido.
    expect(Object.keys(r).sort()).toEqual(["closed", "slots"]);
    expect(r.closed).toBe(false);
  });

  it("serviço mais longo também perde os horários em que não cabe antes de uma reserva", async () => {
    const { getAvailableSlotsAction } = await import("@/app/agendar/actions");
    const other = await createClient();
    const short = await createService({ durationMinutes: 60 });
    const long = await createService({ name: "Longo", durationMinutes: 120 });
    await createBooking({ clientId: other.id, serviceId: short.id, startAt: nextDayAt(14, 0, 2) });

    const r = await getAvailableSlotsAction(long.id, dateKeyDaysAhead(2));
    if ("error" in r) throw new Error(r.error);
    const times = r.slots.map(hhmm);
    expect(times).toContain("15:00"); // 15h–17h cabe
    expect(times).not.toContain("13:00"); // 13h–15h invade as 14h
    expect(times).not.toContain("12:30");
  });

  it("dia sem vagas devolve lista vazia; dia sem expediente é marcado como fechado", async () => {
    const { getAvailableSlotsAction } = await import("@/app/agendar/actions");
    const service = await createService({ durationMinutes: 60 });
    // Preenche o dia inteiro (09–12 e 13–18) com reservas de 1 h.
    for (const h of [9, 10, 11, 13, 14, 15, 16, 17]) await createBooking({ clientId: (await createClient()).id, serviceId: service.id, startAt: nextDayAt(h, 0, 3) });
    const full = await getAvailableSlotsAction(service.id, dateKeyDaysAhead(3));
    expect(full).toEqual({ slots: [], closed: false });

    await prisma.businessHours.updateMany({ where: {}, data: { active: false } });
    expect(await getAvailableSlotsAction(service.id, dateKeyDaysAhead(4))).toEqual({ slots: [], closed: true });
  });

  it("procura o próximo dia com vaga", async () => {
    const { findNextAvailableDayAction } = await import("@/app/agendar/actions");
    const service = await createService({ durationMinutes: 60 });
    for (const h of [9, 10, 11, 13, 14, 15, 16, 17]) await createBooking({ clientId: (await createClient()).id, serviceId: service.id, startAt: nextDayAt(h, 0, 3) });
    // Depois de “dia 2”, o dia 3 está cheio: o próximo com vaga é o 4.
    expect(await findNextAvailableDayAction(service.id, dateKeyDaysAhead(2))).toEqual({ dateKey: dateKeyDaysAhead(4) });
  });

  it("conferência do botão Continuar: livre → true; ocupado por outra cliente → false (sem cache)", async () => {
    const { checkSlotStillAvailableAction } = await import("@/app/agendar/actions");
    const service = await createService({ durationMinutes: 60 });
    const start = nextDayAt(10, 0, 2);
    expect(await checkSlotStillAvailableAction(service.id, start.toISOString())).toEqual({ available: true });
    await createBooking({ clientId: (await createClient()).id, serviceId: service.id, startAt: nextDayAt(10, 30, 2) });
    expect(await checkSlotStillAvailableAction(service.id, start.toISOString())).toEqual({ available: false });
    expect(await checkSlotStillAvailableAction(service.id, "lixo")).toEqual({ available: false });
  });

  it("datas fora do período reservável (passado, além do horizonte) não gastam consultas ao Google", async () => {
    const { getAvailableSlotsAction } = await import("@/app/agendar/actions");
    const admin = await createAdmin();
    await prisma.googleCalendarAccount.create({
      data: { adminUserId: admin.id, accessToken: encryptSecret("t"), refreshToken: encryptSecret("r"), expiryDate: new Date(Date.now() + 3600_000) },
    });
    const fake = makeFakeCalendar();
    __setCalendarFactoryForTests(() => fake.api);
    const service = await createService({ durationMinutes: 60 });

    for (const key of ["2026-01-05", "2031-06-10", dateKeyDaysAhead(200)]) {
      const r = await getAvailableSlotsAction(service.id, key);
      if ("error" in r) throw new Error(r.error);
      expect(r.slots).toEqual([]);
    }
    expect(fake.calls).toEqual([]);

    const ok = await getAvailableSlotsAction(service.id, dateKeyDaysAhead(3)); // dentro do período: consulta normalmente
    if ("error" in ok) throw new Error(ok.error);
    expect(ok.slots.length).toBeGreaterThan(0);
    expect(fake.calls).toContain("freebusy");
  });

  it("compromisso externo do Google remove horários; a listagem usa cache curto, a conferência/confirmação não", async () => {
    const { getAvailableSlotsAction, checkSlotStillAvailableAction } = await import("@/app/agendar/actions");
    const admin = await createAdmin();
    await prisma.googleCalendarAccount.create({
      data: { adminUserId: admin.id, accessToken: encryptSecret("t"), refreshToken: encryptSecret("r"), expiryDate: new Date(Date.now() + 3600_000) },
    });
    const fake = makeFakeCalendar();
    __setCalendarFactoryForTests(() => fake.api);
    const service = await createService({ durationMinutes: 60 });
    const day = dateKeyDaysAhead(2);

    fake.setBusy([{ start: nextDayAt(10, 0, 2).toISOString(), end: nextDayAt(11, 0, 2).toISOString() }]);
    let r = await getAvailableSlotsAction(service.id, day);
    if ("error" in r) throw new Error(r.error);
    expect(r.slots.map(hhmm)).not.toContain("10:00");
    expect(r.slots.map(hhmm)).not.toContain("09:30");
    expect(r.slots.map(hhmm)).toContain("11:00");

    // Segunda listagem logo em seguida: mesma consulta ao Google (cache de 15 s), mesmo resultado.
    const before = fake.calls.filter((c) => c === "freebusy").length;
    r = await getAvailableSlotsAction(service.id, day);
    expect(fake.calls.filter((c) => c === "freebusy").length).toBe(before);

    // A conferência (e a confirmação) sempre consultam o Google na hora.
    fake.setBusy([]);
    expect(await checkSlotStillAvailableAction(service.id, nextDayAt(10, 0, 2).toISOString())).toEqual({ available: true });
    expect(fake.calls.filter((c) => c === "freebusy").length).toBe(before + 1);
  });
});
