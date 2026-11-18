import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, createService, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { getBillingSummary } from "@/lib/billing";
import { updateAppointmentStatus } from "@/lib/booking";
import { createBooking } from "./helpers";

// America/Sao_Paulo = UTC-3 (sem horário de verão). Meia-noite local = 03:00Z.
let clientId: string;
let serviceId: string;

async function add(utcIso: string, priceCents: number, status: string, name = "Serviço") {
  const start = new Date(utcIso);
  await prisma.appointment.create({
    data: { clientId, serviceId, serviceName: name, priceCents, durationMinutes: 1, startAt: start, endAt: new Date(start.getTime() + 1000), status },
  });
}

describe("Faturamento nas viradas de dia, semana e mês (fuso da empresa)", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
    clientId = (await createClient()).id;
    serviceId = (await createService()).id;

    // Segunda 09/03/2026 é o dia de referência. Valores em centavos distintos para identificar cada reserva.
    await add("2026-03-09T02:59:59Z", 1_00, "CONCLUIDA"); // dom 08/03 23:59:59 local  -> semana anterior, dia 08
    await add("2026-03-09T03:00:00Z", 2_00, "CONCLUIDA"); // seg 09/03 00:00:00 local
    await add("2026-03-10T02:59:59Z", 4_00, "CONCLUIDA"); // seg 09/03 23:59:59 local
    await add("2026-03-10T03:00:00Z", 8_00, "CONCLUIDA"); // ter 10/03 00:00:00 local
    await add("2026-03-16T02:59:59Z", 16_00, "CONCLUIDA"); // dom 15/03 23:59:59 local  -> ainda na semana 09–15
    await add("2026-03-16T03:00:00Z", 32_00, "CONCLUIDA"); // seg 16/03 00:00 local     -> semana seguinte
    await add("2026-04-01T02:59:59Z", 64_00, "CONCLUIDA"); // ter 31/03 23:59:59 local  -> ainda em março
    await add("2026-04-01T03:00:00Z", 128_00, "CONCLUIDA"); // qua 01/04 00:00 local    -> abril
    await add("2026-03-01T02:59:59Z", 256_00, "CONCLUIDA"); // sáb 28/02 23:59:59 local -> fevereiro
    // Previsto (confirmadas) e exclusões (canceladas e faltas não entram em nenhum total)
    await add("2026-03-09T15:00:00Z", 1000_00, "CONFIRMADA"); // seg 09/03 12:00 local
    await add("2026-03-09T16:00:00Z", 5000_00, "CANCELADA");
    await add("2026-03-09T17:00:00Z", 7000_00, "FALTA");
  });

  it("DIÁRIO 09/03: só as concluídas desse dia local; previsto separado; cancelada/falta fora", async () => {
    const s = await getBillingSummary("DIARIO", "2026-03-09");
    expect(s.concludedCents).toBe(2_00 + 4_00); // 00:00:00 e 23:59:59 locais
    expect(s.concludedCount).toBe(2);
    expect(s.predictedCents).toBe(1000_00);
    expect(s.predictedCount).toBe(1);
    expect(s.countsByStatus).toMatchObject({ CANCELADA: 1, FALTA: 1 });
  });

  it("DIÁRIO 08/03 e 10/03 pegam exatamente o lado certo da meia-noite", async () => {
    expect((await getBillingSummary("DIARIO", "2026-03-08")).concludedCents).toBe(1_00);
    expect((await getBillingSummary("DIARIO", "2026-03-10")).concludedCents).toBe(8_00);
  });

  it("SEMANAL (seg–dom) da semana de 09/03: de 09/03 00:00 a 15/03 23:59:59; exclui dom 08 e seg 16", async () => {
    for (const ref of ["2026-03-09", "2026-03-12", "2026-03-15"]) {
      const s = await getBillingSummary("SEMANAL", ref);
      expect(s.concludedCents).toBe(2_00 + 4_00 + 8_00 + 16_00);
      expect(s.concludedCount).toBe(4);
      expect(s.predictedCents).toBe(1000_00);
    }
    expect((await getBillingSummary("SEMANAL", "2026-03-16")).concludedCents).toBe(32_00);
    expect((await getBillingSummary("SEMANAL", "2026-03-08")).concludedCents).toBe(1_00); // semana 02–08
  });

  it("MENSAL março: de 01/03 00:00 a 31/03 23:59:59; exclui fev 28 23:59:59 e abr 01 00:00", async () => {
    const m = await getBillingSummary("MENSAL", "2026-03-20");
    expect(m.concludedCents).toBe(1_00 + 2_00 + 4_00 + 8_00 + 16_00 + 32_00 + 64_00);
    expect((await getBillingSummary("MENSAL", "2026-04-15")).concludedCents).toBe(128_00);
    expect((await getBillingSummary("MENSAL", "2026-02-10")).concludedCents).toBe(256_00);
  });

  it("alterar o preço do serviço depois não muda o histórico nem os totais", async () => {
    const svc = await createService({ name: "Gel", priceCents: 6000, durationMinutes: 30 });
    const c = await createClient();
    const startAt = nextDayAt(10, 0, 2);
    const booked = await createBooking({ clientId: c.id, serviceId: svc.id, startAt });

    await prisma.service.update({ where: { id: svc.id }, data: { priceCents: 9900 } });

    const ref = startAt.toISOString().slice(0, 10);
    const before = await getBillingSummary("MENSAL", ref);
    expect(before.predictedCents).toBeGreaterThanOrEqual(6000);
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });
    expect(row.priceCents).toBe(6000); // preço histórico preservado
    const sameDayPredicted = (await getBillingSummary("DIARIO", ref)).predictedCents;
    expect(sameDayPredicted).toBe(6000); // totais usam o preço gravado, não o preço novo (9900)

    // Uma reserva NOVA depois da mudança usa o preço novo
    const next = await createBooking({ clientId: c.id, serviceId: svc.id, startAt: nextDayAt(11, 0, 2) });
    expect(next.priceCents).toBe(9900);
    expect((await getBillingSummary("DIARIO", ref)).predictedCents).toBe(6000 + 9900);
  });

  it("concluir uma reserva a move de 'previsto' para 'concluído' sem duplicar", async () => {
    const past = await prisma.appointment.findFirstOrThrow({ where: { priceCents: 1000_00 } });
    const before = await getBillingSummary("DIARIO", "2026-03-09");
    await updateAppointmentStatus(past.id, "CONCLUIDA");
    const after = await getBillingSummary("DIARIO", "2026-03-09");
    expect(after.predictedCents).toBe(before.predictedCents - 1000_00);
    expect(after.concludedCents).toBe(before.concludedCents + 1000_00);
  });
});
