// Chaves de data usadas em filtros e URLs: "YYYY-MM-DD" (dia) e "YYYY-MM" (mês).
// A validação confere o calendário real (rejeita 2026-13-45 e 2026-02-30),
// não apenas o formato, para que valores vindos da URL nunca virem `Invalid Date`.

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isValidMonthKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  const [y, m] = value.split("-").map(Number);
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12;
}

/** Devolve `value` se for um dia válido; caso contrário, o `fallback`. */
export function dateKeyOr(value: string | undefined, fallback: string): string {
  return isValidDateKey(value) ? value : fallback;
}

export function monthKeyOr(value: string | undefined, fallback: string): string {
  return isValidMonthKey(value) ? value : fallback;
}
