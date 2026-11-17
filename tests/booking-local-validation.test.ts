import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, openAllWeek, createAdmin, createClient, createService, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { __setCalendarFactoryForTests } from "@/lib/google-calendar";
import { createBooking, BookingConflictError, BookingLimitError, BookingValidationError } from "@/lib/booking";
import { makeFakeCalendar } from "./fake-calendar";

async function connectGoogle() {
  const admin = await createAdmin();
  await prisma.googleCalendarAccount.create({
    data: { adminUserId: admin.id, accessToken: encryptSecret("t"), refreshToken: encryptSecret("r"), expiryDate: new Date(Date.now() + 3600_000) },
  });
}

describe("createBooking: regras locais ANTES de consultar o Google (achado 3)", () => {
  let fake: ReturnType<typeof makeFakeCalendar>;
  const freebusyCalls = () => fake.calls.filter((c) => c === "freebusy").length;

  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
    fake = makeFakeCalendar();
    await connectGoogle();
    __setCalendarFactoryForTests(() => fake.api);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    __setCalendarFactoryForTests(null);
    vi.restoreAllMocks();
  });

  it("horário válido: consulta o Google exatamente uma vez e cria a reserva", async () => {
    const client = await createClient();
    const service = await createService();
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
    expect(a.status).toBe("CONFIRMADA");
    expect(freebusyCalls()).toBe(1);
  });

  it("horário válido, mas ocupado na agenda externa: o conflito externo continua sendo detectado", async () => {
    const client = await createClient();
    const service = await createService({ durationMinutes: 60 });
    const startAt = nextDayAt(10, 0);
    fake.setBusy([{ start: startAt.toISOString(), end: new Date(startAt.getTime() + 3600_000).toISOString() }]);
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt })).rejects.toBeInstanceOf(BookingConflictError);
    expect(freebusyCalls()).toBe(1);
    expect(await prisma.appointment.count()).toBe(0);
  });

  describe("solicitações inválidas fazem ZERO chamadas ao Google", () => {
    it("data inválida", async () => {
      const client = await createClient();
      const service = await createService();
      await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: new Date("lixo") })).rejects.toBeInstanceOf(BookingValidationError);
      expect(fake.calls).toEqual([]);
    });

    it("serviço inexistente ou inativo", async () => {
      const client = await createClient();
      const inactive = await createService({ active: false });
      await expect(createBooking({ clientId: client.id, serviceId: inactive.id, startAt: nextDayAt(10, 0) })).rejects.toBeInstanceOf(BookingValidationError);
      await expect(createBooking({ clientId: client.id, serviceId: "nao-existe", startAt: nextDayAt(10, 0) })).rejects.toBeInstanceOf(BookingValidationError);
      expect(fake.calls).toEqual([]);
    });

    it("fora do expediente (dia fechado)", async () => {
      await prisma.businessHours.updateMany({ data: { active: false } });
      const client = await createClient();
      const service = await createService();
      await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) })).rejects.toBeInstanceOf(BookingConflictError);
      expect(fake.calls).toEqual([]);
    });

    it("no horário de almoço", async () => {
      await prisma.businessHours.updateMany({ data: { startTime: "08:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" } });
      const client = await createClient();
      const service = await createService({ durationMinutes: 30 });
      await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(12, 15) })).rejects.toBeInstanceOf(BookingConflictError);
      expect(fake.calls).toEqual([]);
    });

    it("fora da grade de 15 minutos", async () => {
      const client = await createClient();
      const service = await createService();
      await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 7) })).rejects.toBeInstanceOf(BookingConflictError);
      expect(fake.calls).toEqual([]);
    });

    it("sem a antecedência mínima de 30 minutos", async () => {
      const client = await createClient();
      const service = await createService();
      await expect(
        createBooking({ clientId: client.id, serviceId: service.id, startAt: new Date(Date.now() + 5 * 60_000) })
      ).rejects.toBeInstanceOf(BookingConflictError);
      expect(fake.calls).toEqual([]);
    });

    it("no passado", async () => {
      const client = await createClient();
      const service = await createService();
      await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0, -3) })).rejects.toBeInstanceOf(BookingConflictError);
      expect(fake.calls).toEqual([]);
    });

    it("além do horizonte de 60 dias", async () => {
      const client = await createClient();
      const service = await createService();
      await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0, 75) })).rejects.toBeInstanceOf(BookingConflictError);
      expect(fake.calls).toEqual([]);
    });

    it("horário já ocupado por outra reserva ou por bloqueio local", async () => {
      const a = await createClient();
      const b = await createClient();
      const service = await createService({ durationMinutes: 60 });
      const startAt = nextDayAt(10, 0);
      await createBooking({ clientId: a.id, serviceId: service.id, startAt });
      fake.calls.length = 0; // só interessa o que acontece a partir da segunda solicitação

      await expect(createBooking({ clientId: b.id, serviceId: service.id, startAt })).rejects.toBeInstanceOf(BookingConflictError);
      await prisma.blockedPeriod.create({ data: { startAt: nextDayAt(14, 0), endAt: nextDayAt(16, 0) } });
      await expect(createBooking({ clientId: b.id, serviceId: service.id, startAt: nextDayAt(14, 30) })).rejects.toBeInstanceOf(BookingConflictError);
      expect(fake.calls).toEqual([]);
    });

    it("cliente que já está no limite de reservas futuras", async () => {
      const client = await createClient();
      const service = await createService({ durationMinutes: 30 });
      for (const hour of [9, 10, 11]) await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(hour, 0) });
      fake.calls.length = 0;
      await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(15, 0) })).rejects.toBeInstanceOf(BookingLimitError);
      expect(fake.calls).toEqual([]);
    });
  });

  it("agenda externa fora do ar não atrapalha o que as regras locais já recusam (a mensagem é a do horário)", async () => {
    fake.setFreebusyFails(true);
    const client = await createClient();
    const service = await createService();
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 7) })).rejects.toBeInstanceOf(BookingConflictError);
    expect(fake.calls).toEqual([]);
  });

  it("garantia contra duplicidade preservada: 6 solicitações simultâneas do mesmo horário, com o Google conectado, geram UMA reserva", async () => {
    const service = await createService({ durationMinutes: 60 });
    const clients = await Promise.all(Array.from({ length: 6 }, () => createClient()));
    const startAt = nextDayAt(10, 0);
    const results = await Promise.allSettled(clients.map((c) => createBooking({ clientId: c.id, serviceId: service.id, startAt })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof BookingConflictError)).toHaveLength(5);
    expect(await prisma.appointment.count({ where: { status: "CONFIRMADA" } })).toBe(1);
  });
});
