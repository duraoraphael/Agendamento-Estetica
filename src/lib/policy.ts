// Políticas de reserva configuráveis por variável de ambiente (valores inválidos caem no padrão).

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export interface BookingPolicy {
  /** Máximo de reservas futuras ativas (CONFIRMADA) por cliente. Env: MAX_ACTIVE_FUTURE_BOOKINGS (padrão 3). */
  maxActiveFutureBookings: number;
  /** Antecedência mínima, em horas, para a CLIENTE cancelar pelo site. Env: CLIENT_CANCEL_MIN_HOURS (padrão 24). */
  clientCancelMinHours: number;
}

export function getBookingPolicy(): BookingPolicy {
  return {
    maxActiveFutureBookings: intEnv("MAX_ACTIVE_FUTURE_BOOKINGS", 3, 1, 50),
    clientCancelMinHours: intEnv("CLIENT_CANCEL_MIN_HOURS", 24, 0, 24 * 30),
  };
}

/** A cliente ainda pode cancelar pelo site? (faltam pelo menos `minHours` horas para o início) */
export function canClientCancel(startAt: Date, now: Date, minHours: number): boolean {
  return startAt.getTime() - now.getTime() >= minHours * 3_600_000;
}

const hoursLabel = (h: number) => (h === 1 ? "1 hora" : `${h} horas`);

/** Texto da política exibido antes de confirmar e em "Meus agendamentos". */
export function cancelPolicyText(minHours: number): string {
  return minHours === 0
    ? "Você pode cancelar pelo site a qualquer momento antes do atendimento."
    : `Você pode cancelar pelo site até ${hoursLabel(minHours)} antes do horário. Depois disso, fale com o estúdio.`;
}

export function limitReachedMessage(max: number): string {
  return `Você já tem ${max} reserva${max > 1 ? "s" : ""} futura${max > 1 ? "s" : ""} ativa${max > 1 ? "s" : ""}, o limite por cliente. Cancele uma delas ou aguarde um atendimento para agendar outra.`;
}
