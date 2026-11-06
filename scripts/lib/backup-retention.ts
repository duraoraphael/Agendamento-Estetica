// Política de retenção de backups (função pura, testável).
//
// Nome: agenda-AAAAMMDD-HHMMSS.<ext>  (hora UTC).
// Mantém: o backup mais recente de cada um dos últimos `keepDaily` DIAS que tiveram backup
//        + o mais recente de cada um dos últimos `keepMonthly` MESES. Todo o resto pode ser apagado.
// Nunca apaga o único backup existente nem o mais recente.

export interface RetentionOptions {
  keepDaily: number;
  keepMonthly: number;
}

/** Inteiro >= 1 ou o padrão. Evita NaN/0/"" (que fariam a retenção apagar quase todos os backups). */
export function positiveIntOr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : fallback;
}

export const DEFAULT_RETENTION: RetentionOptions = { keepDaily: 14, keepMonthly: 6 };

const NAME = /^agenda-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\./;

export function backupFileName(now: Date, ext: string): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `agenda-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}.${ext}`;
}

export function parseBackupDate(name: string): Date | null {
  const m = NAME.exec(name);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/** Arquivos que podem ser apagados. Nomes que não seguem o padrão são ignorados (nunca apagados). */
export function selectBackupsToDelete(names: string[], opts: RetentionOptions = DEFAULT_RETENTION): string[] {
  const dated = names
    .map((name) => ({ name, date: parseBackupDate(name) }))
    .filter((x): x is { name: string; date: Date } => x.date !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime()); // mais recente primeiro

  const keep = new Set<string>();
  const days = new Set<string>();
  const months = new Set<string>();
  for (const { name, date } of dated) {
    const day = date.toISOString().slice(0, 10);
    const month = date.toISOString().slice(0, 7);
    if (!days.has(day) && days.size < opts.keepDaily) {
      days.add(day);
      keep.add(name);
    }
    if (!months.has(month) && months.size < opts.keepMonthly) {
      months.add(month);
      keep.add(name);
    }
  }
  if (dated[0]) keep.add(dated[0].name);
  return dated.filter((x) => !keep.has(x.name)).map((x) => x.name);
}
