export const TIMEZONE = "America/Sao_Paulo";

// Granularidade dos horários oferecidos para reserva (em minutos).
export const SLOT_STEP_MINUTES = 15;

// Quantos dias no futuro a cliente pode visualizar/reservar.
export const BOOKING_HORIZON_DAYS = 60;

// Antecedência mínima, em minutos, para uma reserva no mesmo dia.
export const MIN_BOOKING_LEAD_MINUTES = 30;

export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  CONFIRMADA: "Confirmada",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
  FALTA: "Falta",
};

export const STATUS_BADGE_CLASSES: Record<string, string> = {
  CONFIRMADA: "bg-status-confirmed-bg text-status-confirmed",
  CONCLUIDA: "bg-status-done-bg text-status-done",
  CANCELADA: "bg-status-cancelled-bg text-status-cancelled",
  FALTA: "bg-status-noshow-bg text-status-noshow",
};

// Situações que efetivamente ocupam um horário na agenda.
export const BLOCKING_STATUSES = ["CONFIRMADA", "CONCLUIDA"] as const;

// Tolerância (em ms) na antecedência mínima ao CONFIRMAR uma reserva, para não
// recusar um horário que ainda aparecia na lista quando a cliente abriu a tela.
export const CONFIRM_LEAD_GRACE_MS = 60_000;

// Tempo máximo (ms) de espera pelo Google Agenda ao consultar disponibilidade.
export const GOOGLE_FREEBUSY_TIMEOUT_MS = 5_000;
export const GOOGLE_EVENTS_TIMEOUT_MS = 10_000;

// Política de limite de tentativas (login e cadastro). Veja src/lib/rate-limit.ts e o README.
export const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
export const RATE_LIMITS = {
  // Falhas de login por e-mail normalizado / por IP (IP mais alto: várias clientes podem dividir o mesmo Wi-Fi).
  loginEmail: 5,
  loginIp: 20,
  // Tentativas de cadastro por e-mail normalizado / por IP.
  signupEmail: 5,
  signupIp: 10,
  // Consultas de horários por cliente por minuto (protege a cota do Google Agenda).
  slotsPerMinute: 60,
  // Gravações das Configurações do site por administradora por minuto (inclui upload de logo).
  settingsPerMinute: 20,
} as const;
