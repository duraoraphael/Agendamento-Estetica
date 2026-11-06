import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { TIMEZONE } from "./constants";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCents(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

export function formatDateBR(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "dd/MM/yyyy");
}

export function formatTimeBR(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "HH:mm");
}

export function formatDateTimeBR(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "dd/MM/yyyy 'às' HH:mm");
}

export function formatWeekdayBR(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "EEEE", { locale: undefined });
}

/** Converte um Date (UTC, como vem do banco) para os componentes locais em America/Sao_Paulo. */
export function toLocalParts(date: Date) {
  const zoned = toZonedTime(date, TIMEZONE);
  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
  };
}

/** Constrói um instante UTC a partir de ano/mês/dia/hora/minuto informados no fuso America/Sao_Paulo. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  const isoLocal = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
  return fromZonedTime(isoLocal, TIMEZONE);
}

/** Retorna a data (YYYY-MM-DD) no fuso America/Sao_Paulo para um instante. */
export function dateKeyInTz(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd");
}

/** Limites (em UTC) do dia local (America/Sao_Paulo) que contém `date`. O fim é exclusivo (início do dia seguinte). */
export function localDayRangeUtc(date: Date = new Date()): { start: Date; end: Date } {
  const key = dateKeyInTz(date);
  const [year, month, day] = key.split("-").map(Number);
  const start = zonedToUtc(year, month, day, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
