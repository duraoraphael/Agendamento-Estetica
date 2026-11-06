import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, createService, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import {
  createBooking,
  cancelOwnBooking,
  updateAppointmentStatus,
  BookingLimitError,
  BookingValidationError,
} from "@/lib/booking";
import { canClientCancel, cancelPolicyText, getBookingPolicy } from "@/lib/policy";

const setEnv = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

describe("Política configurável", () => {
  afterEach(() => {
    setEnv("MAX_ACTIVE_FUTURE_BOOKINGS", undefined);
    setEnv("CLIENT_CANCEL_MIN_HOURS", undefined);
  });

  it("padrões: 3 reservas futuras e 24 horas; valores inválidos caem no padrão", () => {
    expect(getBookingPolicy()).toEqual({ maxActiveFutureBookings: 3, clientCancelMinHours: 24 });
    setEnv("MAX_ACTIVE_FUTURE_BOOKINGS", "abc");
    setEnv("CLIENT_CANCEL_MIN_HOURS", "-5");
    expect(getBookingPolicy()).toEqual({ maxActiveFutureBookings: 3, clientCancelMinHours: 24 });
    setEnv("MAX_ACTIVE_FUTURE_BOOKINGS", "5");
    setEnv("CLIENT_CANCEL_MIN_HOURS", "48");
    expect(getBookingPolicy()).toEqual({ maxActiveFutureBookings: 5, clientCancelMinHours: 48 });
  });

  it("canClientCancel: exatamente 24h pode, 23h59 não", () => {
    const start = new Date("2026-12-10T15:00:00Z");
    expect(canClientCancel(start, new Date("2026-12-09T15:00:00Z"), 24)).toBe(true);
    expect(canClientCancel(start, new Date("2026-12-09T15:00:01Z"), 24)).toBe(false);
    expect(canClientCancel(start, new Date("2026-12-10T14:59:00Z"), 0)).toBe(true);
  });

  it("texto da política menciona o prazo configurado", () => {
    expect(cancelPolicyText(24)).toMatch(/24 horas/);
    expect(cancelPolicyText(1)).toMatch(/1 hora /);
  });
});

describe("Limite de reservas futuras ativas por cliente", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });
  afterEach(() => setEnv("MAX_ACTIVE_FUTURE_BOOKINGS", undefined));

  it("recusa a 4ª reserva futura (padrão 3), com mensagem clara, e não grava", async () => {
    const c = await createClient();
    const s = await createService({ durationMinutes: 30 });
    for (let i = 0; i < 3; i++) await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(9 + i, 0, 2) });
    await expect(createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(14, 0, 2) })).rejects.toBeInstanceOf(BookingLimitError);
    await expect(createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(14, 0, 2) })).rejects.toThrow(/limite por cliente/);
    expect(await prisma.appointment.count({ where: { clientId: c.id } })).toBe(3);
  });

  it("canceladas, passadas e de outras clientes não contam", async () => {
    const c = await createClient();
    const other = await createClient();
    const s = await createService({ durationMinutes: 30 });
    const a = await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(9, 0, 2) });
    await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10, 0, 2) });
    await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(11, 0, 2) });
    // uma reserva passada (concluída) e outras de outra cliente não ocupam o limite
    const past = new Date(Date.now() - 5 * 3600_000);
    await prisma.appointment.create({
      data: { clientId: c.id, serviceId: s.id, serviceName: "x", priceCents: 1, durationMinutes: 30, startAt: past, endAt: new Date(past.getTime() + 1800_000), status: "CONCLUIDA" },
    });
    for (let i = 0; i < 3; i++) await createBooking({ clientId: other.id, serviceId: s.id, startAt: nextDayAt(12 + i, 0, 2) });

    await expect(createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(15, 0, 2) })).rejects.toBeInstanceOf(BookingLimitError);
    await updateAppointmentStatus(a.id, "CANCELADA"); // cancelada libera uma vaga
    expect((await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(15, 0, 2) })).status).toBe("CONFIRMADA");
  });

  it("limite configurável (MAX_ACTIVE_FUTURE_BOOKINGS=1)", async () => {
    setEnv("MAX_ACTIVE_FUTURE_BOOKINGS", "1");
    const c = await createClient();
    const s = await createService({ durationMinutes: 30 });
    await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(9, 0, 2) });
    await expect(createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10, 0, 2) })).rejects.toBeInstanceOf(BookingLimitError);
  });

  it("duas solicitações simultâneas (horários diferentes) com a cliente a 1 reserva do limite: só uma passa", async () => {
    const c = await createClient();
    const s = await createService({ durationMinutes: 30 });
    await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(9, 0, 2) });
    await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10, 0, 2) });
    const results = await Promise.allSettled([
      createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(11, 0, 2) }),
      createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(13, 0, 2) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(BookingLimitError);
    expect(await prisma.appointment.count({ where: { clientId: c.id, status: "CONFIRMADA" } })).toBe(3);
  });

  it("cinco solicitações simultâneas de uma cliente nova: exatamente 3 passam", async () => {
    const c = await createClient();
    const s = await createService({ durationMinutes: 30 });
    const results = await Promise.allSettled(
      [9, 10, 11, 13, 14].map((h) => createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(h, 0, 2) }))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await prisma.appointment.count({ where: { clientId: c.id, status: "CONFIRMADA" } })).toBe(3);
  });

  it("reativação também respeita o limite e mantém a reserva cancelada", async () => {
    const c = await createClient();
    const s = await createService({ durationMinutes: 30 });
    const first = await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(9, 0, 2) });
    await updateAppointmentStatus(first.id, "CANCELADA");
    for (let i = 0; i < 3; i++) await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10 + i, 0, 2) });

    await expect(updateAppointmentStatus(first.id, "CONFIRMADA")).rejects.toBeInstanceOf(BookingLimitError);
    await expect(updateAppointmentStatus(first.id, "CONFIRMADA")).rejects.toThrow(/continua como "cancelada"/);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("CANCELADA");

    const one = await prisma.appointment.findFirstOrThrow({ where: { clientId: c.id, status: "CONFIRMADA" } });
    await updateAppointmentStatus(one.id, "CANCELADA"); // abre uma vaga
    expect((await updateAppointmentStatus(first.id, "CONFIRMADA")).status).toBe("CONFIRMADA");
  });
});

describe("Cancelamento pela cliente", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });
  afterEach(() => setEnv("CLIENT_CANCEL_MIN_HOURS", undefined));

  const future = (clientId: string, serviceId: string, hoursAhead: number, status = "CONFIRMADA") => {
    const start = new Date(Date.now() + hoursAhead * 3600_000);
    return prisma.appointment.create({
      data: { clientId, serviceId, serviceName: "Serviço Teste", priceCents: 4000, durationMinutes: 60, startAt: start, endAt: new Date(start.getTime() + 3600_000), status },
    });
  };

  it("cancela com mais de 24h: preserva histórico e preço, e libera o horário para outra cliente", async () => {
    const c = await createClient();
    const other = await createClient();
    const s = await createService({ priceCents: 5000, durationMinutes: 60 });
    const startAt = nextDayAt(10, 0, 3);
    const a = await createBooking({ clientId: c.id, serviceId: s.id, startAt });

    const res = await cancelOwnBooking({ appointmentId: a.id, clientId: c.id });
    expect(res.status).toBe("CANCELADA");
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe("CANCELADA"); // registro preservado (não apagado)
    expect(row.priceCents).toBe(5000);
    expect((await createBooking({ clientId: other.id, serviceId: s.id, startAt })).status).toBe("CONFIRMADA"); // horário liberado
  });

  it("recusa com menos de 24h (prazo configurável) e mantém a reserva", async () => {
    const c = await createClient();
    const s = await createService();
    const near = await future(c.id, s.id, 10);
    await expect(cancelOwnBooking({ appointmentId: near.id, clientId: c.id })).rejects.toThrow(/até 24 horas antes/);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: near.id } })).status).toBe("CONFIRMADA");

    process.env.CLIENT_CANCEL_MIN_HOURS = "6";
    expect((await cancelOwnBooking({ appointmentId: near.id, clientId: c.id })).status).toBe("CANCELADA");
  });

  it("não cancela a reserva de OUTRA cliente (resposta igual a 'não encontrada')", async () => {
    const owner = await createClient();
    const intruder = await createClient();
    const s = await createService();
    const a = await future(owner.id, s.id, 72);
    await expect(cancelOwnBooking({ appointmentId: a.id, clientId: intruder.id })).rejects.toThrow(/não encontrado/i);
    await expect(cancelOwnBooking({ appointmentId: "id-inexistente", clientId: intruder.id })).rejects.toThrow(/não encontrado/i);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONFIRMADA");
  });

  it("só reservas confirmadas podem ser canceladas pela cliente", async () => {
    const c = await createClient();
    const s = await createService();
    for (const st of ["CANCELADA", "CONCLUIDA", "FALTA"]) {
      const a = await future(c.id, s.id, 100 + Math.floor(Math.random() * 50), st);
      await expect(cancelOwnBooking({ appointmentId: a.id, clientId: c.id })).rejects.toBeInstanceOf(BookingValidationError);
    }
  });

  it("a administradora continua podendo cancelar a qualquer momento", async () => {
    const c = await createClient();
    const s = await createService();
    const near = await future(c.id, s.id, 2);
    expect((await updateAppointmentStatus(near.id, "CANCELADA")).status).toBe("CANCELADA");
  });
});
