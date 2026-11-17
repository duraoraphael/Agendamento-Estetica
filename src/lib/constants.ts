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
  // Com origem validada (proxy confiável): `loginEmail` vale por PAR origem+e-mail, então um terceiro só esgota o
  // próprio par e não a conta da vítima. Sem origem confiável vale por e-mail (única opção; veja src/lib/auth.ts).
  loginEmail: 5,
  loginIp: 20,
  // Teto por e-mail somando TODAS as origens (só com origem validada): freia tentativa distribuída por muitos IPs.
  // Alto de propósito: uma origem sozinha contribui no máximo `loginEmail` tentativas por janela, então esgotar
  // este teto exige dezenas de tentativas vindas de ao menos 10 origens diferentes.
  loginEmailAnySource: 50,
  // Tentativas de cadastro por e-mail normalizado / por IP.
  signupEmail: 5,
  signupIp: 10,
  // Consultas de horários por cliente por minuto (protege a cota do Google Agenda).
  slotsPerMinute: 60,
  // "Ver próximo dia com horários": cada DIA examinado (consulta ao banco + possível chamada ao Google) gasta 1 unidade
  // por cliente por minuto. A busca olha até 21 dias, então 42 = duas buscas completas por minuto.
  nextDayLookupsPerMinute: 42,
  // Gravações das Configurações do site por administradora por minuto (inclui upload de logo).
  settingsPerMinute: 20,
  // Criar ou cancelar reservas, por cliente por minuto (soma dos dois). Sem isso, um laço "reservar e cancelar" encheria a
  // tabela, a fila do Google e a trilha de auditoria. 10 sobra para o uso humano (inclusive tentar outro horário).
  bookingWritesPerMinute: 10,
} as const;
