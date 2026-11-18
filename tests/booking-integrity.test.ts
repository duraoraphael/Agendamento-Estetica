import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, createService, nextDayAt, dateKeyDaysAhead } from "./helpers";
import { prisma } from "@/lib/db";
import { updateAppointmentStatus, BookingConflictError, BookingValidationError } from "@/lib/booking";
import { createBooking } from "./helpers";
import { generateSlotCandidatesForDate, isSlotAvailable } from "@/lib/availability";
import { getBillingSummary } from "@/lib/billing";
import { dateKeyInTz } from "@/lib/format";
import type { AppointmentStatus } from "@/lib/types";

describe("Regras de horário aplicadas no servidor (achado 2)", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("rejeita data inválida com mensagem tratada", async () => {
    const client = await createClient();
    const service = await createService();
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: new Date("abc") })).rejects.toBeInstanceOf(
      BookingValidationError
    );
  });

  it("rejeita horário fora da grade de 15 minutos (14:07)", async () => {
    const client = await createClient();
    const service = await createService({ durationMinutes: 60 });
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(14, 7) })).rejects.toBeInstanceOf(
      BookingConflictError
    );
    expect(await prisma.appointment.count()).toBe(0);
  });

  it("rejeita segundos/milissegundos soltos no horário", async () => {
    const service = await createService({ durationMinutes: 60 });
    const t = new Date(nextDayAt(14, 0).getTime() + 1000);
    expect(await isSlotAvailable(t, service.durationMinutes, prisma)).toBe(false);
  });

  it("aceita um horário alinhado à grade (14:15)", async () => {
    const client = await createClient();
    const service = await createService({ durationMinutes: 60 });
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(14, 15) });
    expect(a.status).toBe("CONFIRMADA");
  });

  it("rejeita datas além do horizonte de 60 dias (+90 dias) e aceita +30 dias", async () => {
    const client = await createClient();
    const service = await createService({ durationMinutes: 60 });
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0, 90) })).rejects.toBeInstanceOf(
      BookingConflictError
    );
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0, 61) })).rejects.toBeInstanceOf(
      BookingConflictError
    );
    const ok = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0, 30) });
    expect(ok.id).toBeTruthy();
  });

  it("rejeita antecedência menor que a mínima", async () => {
    const client = await createClient();
    const service = await createService({ durationMinutes: 15 });
    // Próximo múltiplo de 15 min do dia a pelo menos ~10 min de agora: dentro da antecedência de 30 min.
    const soon = new Date(Math.ceil((Date.now() + 10 * 60_000) / 900_000) * 900_000);
    expect(await isSlotAvailable(soon, 15, prisma)).toBe(false);
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: soon })).rejects.toBeInstanceOf(BookingConflictError);
  });

  it("listagem e confirmação usam a mesma regra: tudo o que a lista oferece é aceito e o resto é recusado", async () => {
    const client = await createClient();
    const service = await createService({ durationMinutes: 45 });
    const key = dateKeyDaysAhead(3);
    const candidates = await generateSlotCandidatesForDate(key, service.durationMinutes);
    expect(candidates.length).toBeGreaterThan(10);

    // A regra de confirmação (isSlotAvailable) concorda com a listagem em TODOS os candidatos.
    for (const c of candidates) {
      expect(await isSlotAvailable(c.start, service.durationMinutes, prisma)).toBe(c.available);
    }

    const free = candidates.find((c) => c.available)!;
    const booked = await createBooking({ clientId: client.id, serviceId: service.id, startAt: free.start });
    expect(booked.startAt.toISOString()).toBe(free.start.toISOString());
  });
});

describe("Status e reativação (achados 1, 3 e 4)", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  let pastSeq = 0;
  async function pastAppointment(clientId: string, serviceId: string, status = "CONFIRMADA") {
    const start = new Date(Date.now() - (3 + 4 * pastSeq++) * 3600_000); // cada reserva num horário diferente (sem sobreposição)
    return prisma.appointment.create({
      data: {
        clientId,
        serviceId,
        serviceName: "Serviço Teste",
        priceCents: 4000,
        durationMinutes: 60,
        startAt: start,
        endAt: new Date(start.getTime() + 3600_000),
        status,
      },
    });
  }

  it("rejeita status inválido (FOO) antes de gravar", async () => {
    const client = await createClient();
    const service = await createService();
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
    await expect(updateAppointmentStatus(a.id, "FOO" as unknown as AppointmentStatus)).rejects.toBeInstanceOf(BookingValidationError);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONFIRMADA");
  });

  it("não permite CONCLUIDA nem FALTA em atendimento futuro", async () => {
    const client = await createClient();
    const service = await createService();
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
    await expect(updateAppointmentStatus(a.id, "CONCLUIDA")).rejects.toBeInstanceOf(BookingValidationError);
    await expect(updateAppointmentStatus(a.id, "FALTA")).rejects.toBeInstanceOf(BookingValidationError);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONFIRMADA");
  });

  it("permite CONCLUIDA e FALTA depois do horário", async () => {
    const client = await createClient();
    const service = await createService();
    const done = await pastAppointment(client.id, service.id);
    expect((await updateAppointmentStatus(done.id, "CONCLUIDA")).status).toBe("CONCLUIDA");
    const miss = await pastAppointment(client.id, service.id);
    expect((await updateAppointmentStatus(miss.id, "FALTA")).status).toBe("FALTA");
  });

  it("A cancela, B reserva, administradora tenta reativar A: conflito, A segue cancelada e só existe 1 confirmada", async () => {
    const a = await createClient({ email: "a1@example.com" });
    const b = await createClient({ email: "b1@example.com" });
    const service = await createService({ priceCents: 5000, durationMinutes: 60 });
    const startAt = nextDayAt(16, 0);

    const first = await createBooking({ clientId: a.id, serviceId: service.id, startAt });
    await updateAppointmentStatus(first.id, "CANCELADA");
    const second = await createBooking({ clientId: b.id, serviceId: service.id, startAt });

    await expect(updateAppointmentStatus(first.id, "CONFIRMADA")).rejects.toMatchObject({
      name: "Error",
      message: expect.stringMatching(/continua como "cancelada"/),
    });
    await expect(updateAppointmentStatus(first.id, "CONFIRMADA")).rejects.toBeInstanceOf(BookingConflictError);

    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("CANCELADA");
    expect(await prisma.appointment.count({ where: { startAt, status: "CONFIRMADA" } })).toBe(1);

    // O faturamento previsto reflete uma única reserva (sem duplicidade).
    const day = dateKeyInTz(startAt);
    const summary = await getBillingSummary("DIARIO", day);
    expect(summary.predictedCount).toBe(1);
    expect(summary.predictedCents).toBe(5000);

    // Quando B cancela, a reativação de A passa a funcionar.
    await updateAppointmentStatus(second.id, "CANCELADA");
    expect((await updateAppointmentStatus(first.id, "CONFIRMADA")).status).toBe("CONFIRMADA");
  });

  it("reativação parcialmente sobreposta também é recusada", async () => {
    const a = await createClient({ email: "a2@example.com" });
    const b = await createClient({ email: "b2@example.com" });
    const service = await createService({ durationMinutes: 60 });
    const first = await createBooking({ clientId: a.id, serviceId: service.id, startAt: nextDayAt(9, 0) });
    await updateAppointmentStatus(first.id, "CANCELADA");
    await createBooking({ clientId: b.id, serviceId: service.id, startAt: nextDayAt(9, 30) });
    await expect(updateAppointmentStatus(first.id, "CONFIRMADA")).rejects.toBeInstanceOf(BookingConflictError);
  });

  it("reativação concorrente com nova reserva: exatamente uma vence", async () => {
    const a = await createClient({ email: "a3@example.com" });
    const b = await createClient({ email: "b3@example.com" });
    const service = await createService({ durationMinutes: 60 });
    const startAt = nextDayAt(11, 0);
    const first = await createBooking({ clientId: a.id, serviceId: service.id, startAt });
    await updateAppointmentStatus(first.id, "CANCELADA");

    const results = await Promise.allSettled([
      updateAppointmentStatus(first.id, "CONFIRMADA"),
      createBooking({ clientId: b.id, serviceId: service.id, startAt }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.appointment.count({ where: { startAt, status: "CONFIRMADA" } })).toBe(1);
  });

  it("dez tentativas simultâneas no mesmo horário: uma reserva persistida", async () => {
    const service = await createService({ durationMinutes: 60 });
    const clients = await Promise.all(Array.from({ length: 10 }, (_, i) => createClient({ email: `c${i}@example.com` })));
    const startAt = nextDayAt(15, 0);
    const results = await Promise.allSettled(clients.map((c) => createBooking({ clientId: c.id, serviceId: service.id, startAt })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BookingConflictError);
    }
    expect(await prisma.appointment.count({ where: { startAt } })).toBe(1);
  });

  it("preserva preço e duração históricos ao mudar o serviço e ao trocar a situação", async () => {
    const client = await createClient();
    const service = await createService({ priceCents: 4000, durationMinutes: 60 });
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
    await prisma.service.update({ where: { id: service.id }, data: { priceCents: 9900, durationMinutes: 90 } });
    await updateAppointmentStatus(a.id, "CANCELADA");
    await updateAppointmentStatus(a.id, "CONFIRMADA");
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.priceCents).toBe(4000);
    expect(after.durationMinutes).toBe(60);
  });
});
