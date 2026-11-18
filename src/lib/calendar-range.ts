import { prisma } from "./db";
import { TIMEZONE, BOOKING_HORIZON_DAYS } from "./constants";

/** Janela do calendário de escolha de horário. Os dias com expediente vêm do banco; as datas, do fuso America/Sao_Paulo. */
export interface CalendarRange {
  todayKey: string;
  maxKey: string;
  /** Dias da semana com expediente (0 = domingo ... 6 = sábado). */
  openWeekdays: number[];
}

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Hoje até o horizonte de reservas, e os dias da semana com expediente ativo (a regra final é a do servidor, ao listar e confirmar). */
export async function buildCalendarRange(now: Date = new Date()): Promise<CalendarRange> {
  const hours = await prisma.businessHours.findMany({ where: { active: true }, select: { dayOfWeek: true } });
  return {
    todayKey: dayKey(now),
    maxKey: dayKey(new Date(now.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60 * 1000)),
    openWeekdays: hours.map((h) => h.dayOfWeek),
  };
}
