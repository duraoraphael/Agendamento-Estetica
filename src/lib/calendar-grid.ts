/** Monta a grade de um mês (semanas de domingo a sábado) para exibição em calendário. */
export function getMonthGrid(monthKey: string): { dateKey: string; inMonth: boolean }[][] {
  const [year, month] = monthKey.split("-").map(Number);
  const firstOfMonth = new Date(year, month - 1, 1);
  const firstWeekday = firstOfMonth.getDay(); // 0=domingo
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: { dateKey: string; inMonth: boolean }[] = [];

  // Dias do mês anterior para completar a primeira semana.
  for (let i = 0; i < firstWeekday; i++) {
    const d = new Date(year, month - 1, 1 - (firstWeekday - i));
    cells.push({ dateKey: toKey(d), inMonth: false });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ dateKey: toKey(new Date(year, month - 1, day)), inMonth: true });
  }

  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    const [y, m, d] = last.dateKey.split("-").map(Number);
    const next = new Date(y, m - 1, d + 1);
    cells.push({ dateKey: toKey(next), inMonth: false });
  }

  const weeks: { dateKey: string; inMonth: boolean }[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function toKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
