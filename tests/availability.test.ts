import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, createService, nextDayAt, dateKeyDaysAhead } from "./helpers";
import { prisma } from "@/lib/db";
import { generateSlotsForDate, isSlotAvailable } from "@/lib/availability";
import { formatTimeBR } from "@/lib/format";

describe("Disponibilidade e prevenção de sobreposição parcial", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("bloqueia horários que terminariam depois de um atendimento já existente (sobreposição parcial)", async () => {
    const client = await createClient();
    const service = await createService({ durationMinutes: 60 });

    // Atendimento existente das 14h às 15h.
    await prisma.appointment.create({
      data: {
        clientId: client.id,
        serviceId: service.id,
        serviceName: service.name,
        priceCents: service.priceCents,
        durationMinutes: service.durationMinutes,
        startAt: nextDayAt(14, 0),
        endAt: nextDayAt(15, 0),
        status: "CONFIRMADA",
      },
    });

    // 13h30 + 60min terminaria às 14h30, sobrepondo o início do atendimento existente.
    expect(await isSlotAvailable(nextDayAt(13, 30), 60, prisma)).toBe(false);
    // 14h30 + 60min terminaria às 15h30, sobrepondo o fim do atendimento existente.
    expect(await isSlotAvailable(nextDayAt(14, 30), 60, prisma)).toBe(false);
    // 13h + 60min termina exatamente às 14h: cabe antes, sem sobrepor.
    expect(await isSlotAvailable(nextDayAt(13, 0), 60, prisma)).toBe(true);
    // 15h + 60min começa exatamente quando o atendimento existente termina.
    expect(await isSlotAvailable(nextDayAt(15, 0), 60, prisma)).toBe(true);

    const slots = await generateSlotsForDate(dateKeyDaysAhead(1), 60);
    const slotTimes = slots.map((s) => formatTimeBR(s));
    expect(slotTimes).not.toContain("13:30");
    expect(slotTimes).not.toContain("14:30");
    expect(slotTimes).toContain("13:00");
    expect(slotTimes).toContain("15:00");
  });

  it("não oferece horários fora do expediente configurado", async () => {
    const service = await createService({ durationMinutes: 30 });
    const dateKey = dateKeyDaysAhead(1);

    await prisma.businessHours.updateMany({ data: { startTime: "09:00", endTime: "12:00" } });

    const slots = await generateSlotsForDate(dateKey, service.durationMinutes);
    const times = slots.map((s) => formatTimeBR(s));

    expect(times.every((t) => t >= "09:00" && t < "12:00")).toBe(true);
  });

  it("não oferece horários durante o intervalo de almoço", async () => {
    const service = await createService({ durationMinutes: 30 });
    const dateKey = dateKeyDaysAhead(1);

    await prisma.businessHours.updateMany({
      data: { startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" },
    });

    const slots = await generateSlotsForDate(dateKey, service.durationMinutes);
    const times = slots.map((s) => formatTimeBR(s));

    expect(times).not.toContain("12:00");
    expect(times).not.toContain("12:30");
    expect(times).toContain("11:30");
    expect(times).toContain("13:00");
  });

  it("não oferece horários dentro de um bloqueio pontual (feriado/folga)", async () => {
    const service = await createService({ durationMinutes: 30 });
    const dateKey = dateKeyDaysAhead(1);

    await prisma.blockedPeriod.create({
      data: { startAt: nextDayAt(10, 0), endAt: nextDayAt(12, 0), reason: "Feriado" },
    });

    const slots = await generateSlotsForDate(dateKey, service.durationMinutes);
    const times = slots.map((s) => formatTimeBR(s));

    expect(times).not.toContain("10:30");
    expect(times).not.toContain("11:30");
    expect(times).toContain("09:30");
  });

  it("não oferece horários no dia em que o expediente está inativo", async () => {
    const service = await createService({ durationMinutes: 30 });
    const dateKey = dateKeyDaysAhead(1);
    const [y, m, d] = dateKey.split("-").map(Number);
    const weekday = new Date(y, m - 1, d).getDay();

    await prisma.businessHours.update({ where: { dayOfWeek: weekday }, data: { active: false } });

    const slots = await generateSlotsForDate(dateKey, service.durationMinutes);
    expect(slots).toHaveLength(0);
  });
});
