import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, openAllWeek, createAdmin, createClient, createService, createVehicleFor, createBooking, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { __setCalendarFactoryForTests, eventIdForAppointment } from "@/lib/google-calendar";
import {
  createBooking as createBookingCore,
  rescheduleOwnBooking,
  cancelOwnBooking,
  subtractInterval,
  BookingConflictError,
  BookingValidationError,
} from "@/lib/booking";
import { makeFakeCalendar } from "./fake-calendar";

describe("Novo agendamento exige veículo (servidor)", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("recusa agendamento sem veículo, com veículo inexistente ou de OUTRA cliente (sem criar nada)", async () => {
    const a = await createClient();
    const b = await createClient();
    const s = await createService();
    const startAt = nextDayAt(10, 0, 4);
    const vb = await createVehicleFor(b.id);

    // @ts-expect-error: de propósito, sem vehicleId (chamada direta, sem passar pela tela)
    await expect(createBookingCore({ clientId: a.id, serviceId: s.id, startAt })).rejects.toBeInstanceOf(BookingValidationError);
    await expect(createBookingCore({ clientId: a.id, serviceId: s.id, startAt, vehicleId: "nao-existe" })).rejects.toBeInstanceOf(BookingValidationError);
    await expect(createBookingCore({ clientId: a.id, serviceId: s.id, startAt, vehicleId: vb.id })).rejects.toBeInstanceOf(BookingValidationError);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it("grava veículo, snapshot e observações; observações inválidas são recusadas", async () => {
    const c = await createClient();
    const s = await createService();
    const v = await createVehicleFor(c.id, { brand: "Fiat", model: "Argo", plate: "ABC1D23" });
    const startAt = nextDayAt(10, 0, 4);

    await expect(createBookingCore({ clientId: c.id, serviceId: s.id, startAt, vehicleId: v.id, notes: "x".repeat(501) })).rejects.toBeInstanceOf(BookingValidationError);
    await expect(createBookingCore({ clientId: c.id, serviceId: s.id, startAt, vehicleId: v.id, notes: "oi\u0000" })).rejects.toBeInstanceOf(BookingValidationError);
    expect(await prisma.appointment.count()).toBe(0);

    const appt = await createBookingCore({ clientId: c.id, serviceId: s.id, startAt, vehicleId: v.id, notes: "  Atenção nas rodas.  " });
    expect(appt).toMatchObject({ vehicleId: v.id, vehicleBrandSnapshot: "Fiat", vehicleModelSnapshot: "Argo", vehiclePlateSnapshot: "ABC1D23", notes: "Atenção nas rodas." });
  });

  it("reservas antigas, sem veículo, continuam válidas (vehicleId e snapshots nulos)", async () => {
    const c = await createClient();
    const s = await createService();
    const legacy = await prisma.appointment.create({
      data: { clientId: c.id, serviceId: s.id, serviceName: s.name, priceCents: 4000, durationMinutes: 60, startAt: nextDayAt(9, 0, 5), endAt: nextDayAt(10, 0, 5) },
    });
    expect(legacy).toMatchObject({ vehicleId: null, vehicleBrandSnapshot: null, vehiclePlateSnapshot: null, notes: null });
    // ainda pode ser cancelada normalmente
    await expect(cancelOwnBooking({ appointmentId: legacy.id, clientId: c.id })).resolves.toMatchObject({ status: "CANCELADA" });
  });
});

describe("Reagendamento", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  async function setup() {
    const c = await createClient();
    const s = await createService({ durationMinutes: 60, priceCents: 9900 });
    const v = await createVehicleFor(c.id);
    const appt = await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10, 0, 4), vehicleId: v.id, notes: "obs" });
    return { c, s, v, appt };
  }

  it("move o horário e preserva serviço, preço, duração, veículo e observações; registra auditoria sem dados pessoais", async () => {
    const { c, appt, v } = await setup();
    const newStart = nextDayAt(15, 0, 4);
    const moved = await rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: newStart });

    expect(moved.startAt.toISOString()).toBe(newStart.toISOString());
    expect(moved.endAt.getTime() - moved.startAt.getTime()).toBe(60 * 60_000);
    expect(moved).toMatchObject({ status: "CONFIRMADA", priceCents: 9900, durationMinutes: 60, serviceName: appt.serviceName, vehicleId: v.id, notes: "obs", vehiclePlateSnapshot: appt.vehiclePlateSnapshot });

    const log = await prisma.auditLog.findMany({ where: { action: "booking_rescheduled" } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ category: "MARCACAO", actorId: c.id, targetId: appt.id });
    const text = JSON.stringify(log[0]);
    for (const secret of [c.email, c.phone, appt.vehiclePlateSnapshot as string]) expect(text).not.toContain(secret);
  });

  it("libera o horário antigo e ocupa o novo (outra cliente consegue reservar o antigo)", async () => {
    const { c, s, appt } = await setup();
    const other = await createClient();
    await rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: nextDayAt(15, 0, 4) });
    await expect(createBooking({ clientId: other.id, serviceId: s.id, startAt: nextDayAt(10, 0, 4) })).resolves.toBeTruthy();
    await expect(createBooking({ clientId: other.id, serviceId: s.id, startAt: nextDayAt(15, 0, 4) })).rejects.toBeInstanceOf(BookingConflictError);
  });

  it("permite deslocar para um horário que se sobrepõe ao PRÓPRIO horário antigo (a própria reserva não conta como ocupada)", async () => {
    const { c, appt } = await setup();
    const moved = await rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: nextDayAt(10, 30, 4) });
    expect(moved.startAt.toISOString()).toBe(nextDayAt(10, 30, 4).toISOString());
  });

  it("conflito com outra reserva: erro, e a reserva continua EXATAMENTE no horário anterior (atomicidade)", async () => {
    const { c, s, appt } = await setup();
    const other = await createClient();
    await createBooking({ clientId: other.id, serviceId: s.id, startAt: nextDayAt(15, 0, 4) });
    await expect(rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: nextDayAt(15, 30, 4) })).rejects.toBeInstanceOf(BookingConflictError);
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(after.startAt.toISOString()).toBe(appt.startAt.toISOString());
    expect(after.endAt.toISOString()).toBe(appt.endAt.toISOString());
    expect(await prisma.auditLog.count({ where: { action: "booking_rescheduled" } })).toBe(0);
  });

  it("IDOR: reserva de outra cliente responde 'não encontrado' e não muda", async () => {
    const { appt } = await setup();
    const intruder = await createClient();
    await expect(rescheduleOwnBooking({ appointmentId: appt.id, clientId: intruder.id, newStartAt: nextDayAt(15, 0, 4) })).rejects.toThrow("Agendamento não encontrado.");
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(after.startAt.toISOString()).toBe(appt.startAt.toISOString());
  });

  it("só reserva confirmada e futura; respeita a antecedência mínima da política; recusa o mesmo horário e datas inválidas", async () => {
    const { c, appt } = await setup();
    // dentro do prazo da política (a 2 h do início): recusado
    await expect(
      rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: nextDayAt(15, 0, 4), now: new Date(appt.startAt.getTime() - 2 * 3_600_000) })
    ).rejects.toThrow(/reagendamento pelo site é permitido até/);
    // mesmo horário
    await expect(rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: appt.startAt })).rejects.toThrow(/já é o horário/);
    // data inválida
    await expect(rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: new Date("lixo") })).rejects.toBeInstanceOf(BookingValidationError);
    // cancelada
    await cancelOwnBooking({ appointmentId: appt.id, clientId: c.id });
    await expect(rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: nextDayAt(15, 0, 4) })).rejects.toThrow(/confirmada e futura/);
  });

  it("aplica as mesmas regras de horário da reserva (grade de 15 min, horizonte)", async () => {
    const { c, appt } = await setup();
    await expect(rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: nextDayAt(15, 7, 4) })).rejects.toBeInstanceOf(BookingConflictError); // fora da grade
    await expect(rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: nextDayAt(10, 0, 200) })).rejects.toBeInstanceOf(BookingConflictError); // além do horizonte
  });

  it("concorrência: reagendar e reservar o MESMO horário ao mesmo tempo — só um vence, e quem perde fica como estava", async () => {
    for (let round = 0; round < 3; round++) {
      await resetDb();
      await openAllWeek();
      const { c, s, appt } = await setup();
      const other = await createClient();
      const target = nextDayAt(15, 0, 4);
      const results = await Promise.allSettled([
        rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: target }),
        createBooking({ clientId: other.id, serviceId: s.id, startAt: target }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const mine = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
      const atTarget = await prisma.appointment.count({ where: { startAt: target, status: "CONFIRMADA" } });
      expect(atTarget).toBe(1);
      // se a minha remarcação perdeu, continuo às 10:00; se ganhou, estou no novo horário
      expect([appt.startAt.toISOString(), target.toISOString()]).toContain(mine.startAt.toISOString());
    }
  });

  it("duas remarcações simultâneas para o mesmo horário: só uma vale", async () => {
    const c1 = await createClient();
    const c2 = await createClient();
    const s = await createService();
    const a1 = await createBooking({ clientId: c1.id, serviceId: s.id, startAt: nextDayAt(9, 0, 4) });
    const a2 = await createBooking({ clientId: c2.id, serviceId: s.id, startAt: nextDayAt(11, 0, 4) });
    const target = nextDayAt(16, 0, 4);
    const results = await Promise.allSettled([
      rescheduleOwnBooking({ appointmentId: a1.id, clientId: c1.id, newStartAt: target }),
      rescheduleOwnBooking({ appointmentId: a2.id, clientId: c2.id, newStartAt: target }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.appointment.count({ where: { startAt: target } })).toBe(1);
  });

  it("subtractInterval remove só o trecho do horário antigo", () => {
    const t = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 1, h, m));
    expect(subtractInterval([{ start: t(10), end: t(11) }], { start: t(10), end: t(11) })).toEqual([]);
    expect(subtractInterval([{ start: t(9), end: t(12) }], { start: t(10), end: t(11) })).toEqual([
      { start: t(9), end: t(10) },
      { start: t(11), end: t(12) },
    ]);
    expect(subtractInterval([{ start: t(13), end: t(14) }], { start: t(10), end: t(11) })).toEqual([{ start: t(13), end: t(14) }]);
  });
});

describe("Reagendamento com Google Agenda (simulado)", () => {
  let fake: ReturnType<typeof makeFakeCalendar>;

  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
    fake = makeFakeCalendar();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = await createAdmin();
    await prisma.googleCalendarAccount.create({
      data: { adminUserId: admin.id, accessToken: encryptSecret("t"), refreshToken: encryptSecret("r"), expiryDate: new Date(Date.now() + 3_600_000) },
    });
    __setCalendarFactoryForTests(() => fake.api);
  });

  afterEach(() => {
    __setCalendarFactoryForTests(null);
    vi.restoreAllMocks();
  });

  it("atualiza o MESMO evento para o novo horário (sem duplicar) e inclui veículo e observações no evento da administração", async () => {
    const c = await createClient();
    const s = await createService();
    const v = await createVehicleFor(c.id, { brand: "Fiat", model: "Argo", plate: "ABC1D23" });
    const appt = await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10, 0, 4), vehicleId: v.id, notes: "Rodas" });
    const id = eventIdForAppointment(appt.id);
    expect(fake.live()).toHaveLength(1);
    expect(fake.events.get(id)?.description).toContain("Veículo: Fiat Argo — placa ABC1D23");
    expect(fake.events.get(id)?.description).toContain("Observações: Rodas");

    const newStart = nextDayAt(15, 0, 4);
    await rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: newStart });
    expect(fake.live()).toHaveLength(1);
    expect(new Date(fake.events.get(id)?.start.dateTime).toISOString()).toBe(newStart.toISOString());
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(row.googleSyncStatus).toBe("SINCRONIZADO");
  });

  it("o evento da própria reserva no Google não bloqueia um deslocamento curto (falso conflito)", async () => {
    const c = await createClient();
    const s = await createService();
    const appt = await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10, 0, 4) });
    // O Google devolve o evento desta reserva como ocupado no horário antigo.
    fake.setBusy([{ start: appt.startAt.toISOString(), end: appt.endAt.toISOString() }]);
    const moved = await rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: nextDayAt(10, 30, 4) });
    expect(moved.startAt.toISOString()).toBe(nextDayAt(10, 30, 4).toISOString());
  });

  it("um compromisso REAL no Google no novo horário continua bloqueando", async () => {
    const c = await createClient();
    const s = await createService();
    const appt = await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10, 0, 4) });
    fake.setBusy([{ start: nextDayAt(15, 0, 4).toISOString(), end: nextDayAt(16, 0, 4).toISOString() }]);
    await expect(rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: nextDayAt(15, 0, 4) })).rejects.toBeInstanceOf(BookingConflictError);
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(after.startAt.toISOString()).toBe(appt.startAt.toISOString());
  });

  it("falha na sincronização NÃO desfaz o reagendamento: fica 'Falha ao sincronizar' para nova tentativa", async () => {
    const c = await createClient();
    const s = await createService();
    const appt = await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10, 0, 4) });
    fake.api.events.update.mockRejectedValueOnce(Object.assign(new Error("fora do ar"), { code: 500 }));
    const moved = await rescheduleOwnBooking({ appointmentId: appt.id, clientId: c.id, newStartAt: nextDayAt(15, 0, 4) });
    expect(moved.startAt.toISOString()).toBe(nextDayAt(15, 0, 4).toISOString());
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(row.googleSyncStatus).toBe("ERRO");
  });
});
