import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, createService, nextDayAt, dateKeyDaysAhead } from "./helpers";
import { prisma } from "@/lib/db";
import { getBillingSummary, getPeriodRange } from "@/lib/billing";

/** Soma `hour` horas (em ms) a um instante UTC que representa meia-noite local, mantendo o dia local. Seguro porque America/Sao_Paulo não observa horário de verão atualmente. */
function atHour(localMidnightUtc: Date, hour: number): Date {
  return new Date(localMidnightUtc.getTime() + hour * 60 * 60000);
}

async function seedAppointment(opts: {
  clientId: string;
  serviceId: string;
  serviceName: string;
  priceCents: number;
  startAt: Date;
  status: "CONFIRMADA" | "CONCLUIDA" | "CANCELADA" | "FALTA";
}) {
  return prisma.appointment.create({
    data: {
      clientId: opts.clientId,
      serviceId: opts.serviceId,
      serviceName: opts.serviceName,
      priceCents: opts.priceCents,
      durationMinutes: 60,
      startAt: opts.startAt,
      endAt: new Date(opts.startAt.getTime() + 60 * 60000),
      status: opts.status,
    },
  });
}

describe("Dashboard de faturamento", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("calcula faturamento concluído e valor previsto no período diário, excluindo cancelamentos e faltas", async () => {
    const client = await createClient();
    const manicure = await createService({ name: "Manicure", priceCents: 4000 });
    const pedicure = await createService({ name: "Pedicure", priceCents: 5000 });

    await seedAppointment({ clientId: client.id, serviceId: manicure.id, serviceName: manicure.name, priceCents: 4000, startAt: nextDayAt(9, 0), status: "CONCLUIDA" });
    await seedAppointment({ clientId: client.id, serviceId: pedicure.id, serviceName: pedicure.name, priceCents: 5000, startAt: nextDayAt(10, 0), status: "CONCLUIDA" });
    await seedAppointment({ clientId: client.id, serviceId: manicure.id, serviceName: manicure.name, priceCents: 4000, startAt: nextDayAt(11, 0), status: "CONFIRMADA" });
    await seedAppointment({ clientId: client.id, serviceId: manicure.id, serviceName: manicure.name, priceCents: 4000, startAt: nextDayAt(12, 0), status: "CANCELADA" });
    await seedAppointment({ clientId: client.id, serviceId: manicure.id, serviceName: manicure.name, priceCents: 4000, startAt: nextDayAt(13, 0), status: "FALTA" });

    const summary = await getBillingSummary("DIARIO", dateKeyDaysAhead(1));

    expect(summary.concludedCents).toBe(9000); // 4000 + 5000
    expect(summary.concludedCount).toBe(2);
    expect(summary.predictedCents).toBe(4000);
    expect(summary.predictedCount).toBe(1);
    expect(summary.countsByStatus.CONCLUIDA).toBe(2);
    expect(summary.countsByStatus.CONFIRMADA).toBe(1);
    expect(summary.countsByStatus.CANCELADA).toBe(1);
    expect(summary.countsByStatus.FALTA).toBe(1);

    const manicureRevenue = summary.revenueByService.find((s) => s.name === "Manicure");
    expect(manicureRevenue?.cents).toBe(4000);
  });

  it("agrega corretamente no período semanal mesmo com atendimentos em dias diferentes da semana", async () => {
    const client = await createClient();
    const service = await createService({ name: "Esmaltação", priceCents: 3000 });

    const refKey = dateKeyDaysAhead(1);
    const week = getPeriodRange("SEMANAL", refKey);

    // Dois atendimentos dentro da mesma semana (segunda e quarta daquela semana).
    await seedAppointment({ clientId: client.id, serviceId: service.id, serviceName: service.name, priceCents: 3000, startAt: atHour(week.start, 9), status: "CONCLUIDA" });
    await seedAppointment({
      clientId: client.id,
      serviceId: service.id,
      serviceName: service.name,
      priceCents: 3000,
      startAt: atHour(new Date(week.start.getTime() + 2 * 24 * 60 * 60000), 9),
      status: "CONCLUIDA",
    });
    // Fora da semana (já na semana seguinte) não deve entrar na soma.
    await seedAppointment({ clientId: client.id, serviceId: service.id, serviceName: service.name, priceCents: 3000, startAt: atHour(week.end, 9), status: "CONCLUIDA" });

    const summary = await getBillingSummary("SEMANAL", refKey);

    expect(summary.concludedCents).toBe(6000);
    expect(summary.concludedCount).toBe(2);
    const totalChart = summary.chart.reduce((sum, p) => sum + p.cents, 0);
    expect(totalChart).toBe(6000);
  });

  it("agrega corretamente no período mensal", async () => {
    const client = await createClient();
    const service = await createService({ name: "Alongamento", priceCents: 12000 });

    await seedAppointment({ clientId: client.id, serviceId: service.id, serviceName: service.name, priceCents: 12000, startAt: nextDayAt(9, 0, 1), status: "CONCLUIDA" });

    const refKey = dateKeyDaysAhead(1);
    const summary = await getBillingSummary("MENSAL", refKey);

    expect(summary.concludedCents).toBe(12000);
    const totalChart = summary.chart.reduce((sum, p) => sum + p.cents, 0);
    expect(totalChart).toBe(summary.concludedCents);
  });
});
