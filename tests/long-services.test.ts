import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, createService, createBooking, nextDayAt, dateKeyDaysAhead } from "./helpers";
import { prisma } from "@/lib/db";
import { generateSlotsForDate, isSlotAvailable } from "@/lib/availability";
import { BookingConflictError } from "@/lib/booking";
import { formatTimeBR } from "@/lib/format";

/**
 * Serviços LONGOS (mais que o menor turno do dia) atravessam o almoço e passam a mostrar todos os inícios livres.
 * Expediente do teste: 09h–18h com almoço 12h–13h => turnos de 3 h (manhã) e 5 h (tarde), como no seu banco.
 */
const DAY = 2;
const times = async (minutes: number) => (await generateSlotsForDate(dateKeyDaysAhead(DAY), minutes)).map((s) => formatTimeBR(s));
const every15 = (from: string, to: string) => {
  const out: string[] = [];
  let [h, m] = from.split(":").map(Number);
  const [eh, em] = to.split(":").map(Number);
  while (h * 60 + m <= eh * 60 + em) {
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 15;
    if (m === 60) {
      h += 1;
      m = 0;
    }
  }
  return out;
};

beforeEach(async () => {
  await resetDb();
  await openAllWeek();
  await prisma.businessHours.updateMany({ data: { startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" } });
});

describe("Serviços longos mostram todos os horários livres (atravessam o almoço)", () => {
  it("vitrificação (5 h): todos os inícios de 09:00 até 13:00, e não só um", async () => {
    expect(await times(300)).toEqual(every15("09:00", "13:00"));
  });

  it("polimento / cristalização (4 h): todos os inícios de 09:00 até 14:00", async () => {
    expect(await times(240)).toEqual(every15("09:00", "14:00"));
  });

  it("serviço que cabe nos dois turnos (3 h, 1 h) NÃO muda: o almoço continua bloqueando", async () => {
    // 3 h = exatamente o menor turno: manhã só 09:00; tarde 13:00 a 15:00.
    expect(await times(180)).toEqual([...every15("09:00", "09:00"), ...every15("13:00", "15:00")]);
    // 1 h: manhã 09:00 a 11:00; tarde 13:00 a 17:00. Nada entre 11:15 e 12:45.
    expect(await times(60)).toEqual([...every15("09:00", "11:00"), ...every15("13:00", "17:00")]);
  });

  it("quem já agendou fica sem: horários que sobrepõem a reserva somem, os livres continuam", async () => {
    const client = await createClient();
    const short = await createService({ name: "Curto", durationMinutes: 60 });
    // Reserva existente das 16h às 17h.
    await createBooking({ clientId: client.id, serviceId: short.id, startAt: nextDayAt(16, 0, DAY) });
    // 5 h: precisa terminar até 16:00 => inícios 09:00 a 11:00.
    expect(await times(300)).toEqual(every15("09:00", "11:00"));
    // 4 h: termina até 16:00 => 09:00 a 12:00 (atravessa o almoço); depois das 17:00 não cabe mais.
    expect(await times(240)).toEqual(every15("09:00", "12:00"));
  });

  it("com o dia todo bloqueado, não aparece nada (sem horário fantasma)", async () => {
    await prisma.blockedPeriod.create({ data: { startAt: nextDayAt(9, 0, DAY), endAt: nextDayAt(18, 0, DAY), reason: "Folga" } });
    expect(await times(300)).toEqual([]);
  });

  it("bloqueio dentro do período do almoço também tira os inícios que o atravessariam", async () => {
    await prisma.blockedPeriod.create({ data: { startAt: nextDayAt(12, 0, DAY), endAt: nextDayAt(13, 0, DAY), reason: "Visita" } });
    // Os inícios de 09:00 a 12:45 cobrem o intervalo 12h-13h e somem; só 13:00 (13h-18h) fica livre.
    expect(await times(300)).toEqual(["13:00"]);
    // Serviço curto continua com os inícios fora do almoço.
    expect(await times(60)).toContain("11:00");
  });

  it("listar e confirmar seguem a mesma regra", async () => {
    const at = (h: number, m: number) => nextDayAt(h, m, DAY);
    // 5 h atravessando o almoço: 09:00, 12:15 e 13:00 valem; 13:15 estouraria o fechamento (18:15); 08:45 é antes de abrir.
    expect(await isSlotAvailable(at(9, 0), 300, prisma)).toBe(true);
    expect(await isSlotAvailable(at(12, 15), 300, prisma)).toBe(true);
    expect(await isSlotAvailable(at(13, 0), 300, prisma)).toBe(true);
    expect(await isSlotAvailable(at(13, 15), 300, prisma)).toBe(false);
    expect(await isSlotAvailable(at(8, 45), 300, prisma)).toBe(false);
    // Fora da grade de 15 min não vale.
    expect(await isSlotAvailable(at(9, 10), 300, prisma)).toBe(false);
    // Serviço curto continua barrado no almoço.
    expect(await isSlotAvailable(at(12, 0), 60, prisma)).toBe(false);
    expect(await isSlotAvailable(at(11, 30), 60, prisma)).toBe(false);
  });

  it("agendar de verdade: a reserva de 5 h atravessando o almoço é aceita e o horário que sobrepõe a ela é recusado", async () => {
    const a = await createClient();
    const b = await createClient();
    const vitrificacao = await createService({ name: "Vitrificação", durationMinutes: 300 });
    const lavagem = await createService({ name: "Lavagem", durationMinutes: 60 });

    const booking = await createBooking({ clientId: a.id, serviceId: vitrificacao.id, startAt: nextDayAt(10, 0, DAY) });
    expect(formatTimeBR(booking.endAt)).toBe("15:00");

    await expect(createBooking({ clientId: b.id, serviceId: lavagem.id, startAt: nextDayAt(14, 0, DAY) })).rejects.toBeInstanceOf(BookingConflictError);
    // Depois das 15h está livre.
    expect(await createBooking({ clientId: b.id, serviceId: lavagem.id, startAt: nextDayAt(15, 0, DAY) })).toBeTruthy();
    // E a lista de 5 h desse dia agora não oferece mais nada (reservas de 10h-15h e 15h-16h).
    expect(await times(300)).toEqual([]);
  });

  it("dia sem almoço, ou com um turno só, não muda (e serviço maior que o expediente continua sem horário)", async () => {
    await prisma.businessHours.updateMany({ data: { startTime: "09:00", endTime: "13:00", breakStart: null, breakEnd: null } });
    // Sem almoço: 4 h cabe exatamente no turno único; 5 h não cabe em lugar nenhum.
    expect(await times(240)).toEqual(["09:00"]);
    expect(await times(300)).toEqual([]);
    // Almoço na ponta (um turno só): nada de mudança.
    await prisma.businessHours.updateMany({ data: { startTime: "09:00", endTime: "18:00", breakStart: "17:00", breakEnd: "18:00" } });
    expect(await times(480)).toEqual(["09:00"]);
    expect(await times(540)).toEqual([]);
  });
});
