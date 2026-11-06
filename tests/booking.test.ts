import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, createAdmin, createService, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { createBooking, updateAppointmentStatus, BookingConflictError } from "@/lib/booking";
import { isSlotAvailable } from "@/lib/availability";
import { getAppointmentForClient } from "@/lib/appointments";
import { localDayRangeUtc } from "@/lib/format";

describe("Criação de reserva e visibilidade imediata", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("confirma a reserva e ela aparece imediatamente na consulta usada pelo painel administrativo", async () => {
    const client = await createClient();
    const service = await createService({ priceCents: 5000, durationMinutes: 45 });
    const startAt = nextDayAt(10, 0);

    const appointment = await createBooking({ clientId: client.id, serviceId: service.id, startAt });
    expect(appointment.status).toBe("CONFIRMADA");

    // Mesma consulta que o painel "Agendamentos de hoje"/lista administrativa faria.
    const visibleToAdmin = await prisma.appointment.findMany({
      where: { startAt: { gte: startAt, lt: new Date(startAt.getTime() + 60000) } },
    });
    expect(visibleToAdmin.map((a) => a.id)).toContain(appointment.id);
  });
});

describe("Prevenção de sobreposição sob concorrência", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("confirma apenas uma reserva quando duas clientes tentam o mesmo horário simultaneamente", async () => {
    const clientA = await createClient({ email: "a@example.com" });
    const clientB = await createClient({ email: "b@example.com" });
    const service = await createService({ durationMinutes: 60 });
    const startAt = nextDayAt(16, 0);

    const results = await Promise.allSettled([
      createBooking({ clientId: clientA.id, serviceId: service.id, startAt }),
      createBooking({ clientId: clientB.id, serviceId: service.id, startAt }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BookingConflictError);

    const confirmedCount = await prisma.appointment.count({
      where: { startAt, status: "CONFIRMADA" },
    });
    expect(confirmedCount).toBe(1);
  });

  it("rejeita uma segunda reserva que apenas sobrepõe parcialmente a primeira", async () => {
    const clientA = await createClient({ email: "c@example.com" });
    const clientB = await createClient({ email: "d@example.com" });
    const service = await createService({ durationMinutes: 60 });

    await createBooking({ clientId: clientA.id, serviceId: service.id, startAt: nextDayAt(9, 0) });

    await expect(
      createBooking({ clientId: clientB.id, serviceId: service.id, startAt: nextDayAt(9, 30) })
    ).rejects.toBeInstanceOf(BookingConflictError);
  });
});

describe("Cancelamento libera o horário", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("libera o horário para novas reservas depois que a administradora cancela", async () => {
    const client = await createClient();
    const service = await createService({ durationMinutes: 60 });
    const startAt = nextDayAt(11, 0);

    const appointment = await createBooking({ clientId: client.id, serviceId: service.id, startAt });
    expect(await isSlotAvailable(startAt, 60, prisma)).toBe(false);

    await updateAppointmentStatus(appointment.id, "CANCELADA");
    expect(await isSlotAvailable(startAt, 60, prisma)).toBe(true);

    // E uma nova cliente consegue reservar o mesmo horário.
    const otherClient = await createClient({ email: "outra@example.com" });
    const newAppointment = await createBooking({ clientId: otherClient.id, serviceId: service.id, startAt });
    expect(newAppointment.status).toBe("CONFIRMADA");
  });
});

describe("Preço e duração são preservados historicamente", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("mantém o preço/duração da reserva mesmo após o serviço ser alterado depois", async () => {
    const client = await createClient();
    const service = await createService({ priceCents: 4000, durationMinutes: 45 });

    const appointment = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(9, 0) });
    expect(appointment.priceCents).toBe(4000);
    expect(appointment.durationMinutes).toBe(45);

    await prisma.service.update({ where: { id: service.id }, data: { priceCents: 6000, durationMinutes: 60 } });

    const reloaded = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(reloaded.priceCents).toBe(4000);
    expect(reloaded.durationMinutes).toBe(45);

    // Uma nova reserva do mesmo serviço já reflete o novo preço/duração.
    const newAppointment = await createBooking({
      clientId: client.id,
      serviceId: service.id,
      startAt: nextDayAt(14, 0),
    });
    expect(newAppointment.priceCents).toBe(6000);
    expect(newAppointment.durationMinutes).toBe(60);
  });
});

describe("Acesso indevido a reservas de outra cliente", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("não permite que uma cliente veja a reserva de outra alterando o id diretamente", async () => {
    const owner = await createClient({ email: "dona@example.com" });
    const attacker = await createClient({ email: "atacante@example.com" });
    const service = await createService();

    const appointment = await createBooking({ clientId: owner.id, serviceId: service.id, startAt: nextDayAt(9, 0) });

    const ownerView = await getAppointmentForClient(appointment.id, owner.id);
    expect(ownerView?.id).toBe(appointment.id);

    const attackerView = await getAppointmentForClient(appointment.id, attacker.id);
    expect(attackerView).toBeNull();
  });

  it("admin continua com acesso a todos os agendamentos independente do dono", async () => {
    const client = await createClient();
    const service = await createService();
    await createAdmin();
    const appointment = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(9, 0) });

    const { start, end } = localDayRangeUtc(nextDayAt(9, 0));
    const adminList = await prisma.appointment.findMany({ where: { startAt: { gte: start, lt: end } } });
    expect(adminList.map((a) => a.id)).toContain(appointment.id);
  });
});

describe("Histórico da cliente", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("separa corretamente próximos horários e histórico", async () => {
    const client = await createClient();
    const service = await createService();

    const upcomingAppt = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(9, 0) });

    const pastAppt = await prisma.appointment.create({
      data: {
        clientId: client.id,
        serviceId: service.id,
        serviceName: service.name,
        priceCents: service.priceCents,
        durationMinutes: service.durationMinutes,
        startAt: nextDayAt(9, 0, -5),
        endAt: nextDayAt(10, 0, -5),
        status: "CONCLUIDA",
      },
    });

    const { splitUpcomingAndHistory } = await import("@/lib/appointments");
    const all = await prisma.appointment.findMany({ where: { clientId: client.id } });
    const { upcoming, history } = splitUpcomingAndHistory(all);

    expect(upcoming.map((a) => a.id)).toEqual([upcomingAppt.id]);
    expect(history.map((a) => a.id)).toEqual([pastAppt.id]);
  });
});
