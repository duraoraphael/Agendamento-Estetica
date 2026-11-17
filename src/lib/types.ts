// Os campos de "enum" dos modelos são strings no banco (validadas aqui e por CHECK nas migrações). Estes tipos garantem a
// tipagem correta no restante da aplicação.

export type Role = "CLIENTE" | "ADMIN";

export type AppointmentStatus = "CONFIRMADA" | "CONCLUIDA" | "CANCELADA" | "FALTA";

export type GoogleSyncStatus = "NAO_CONECTADO" | "PENDENTE" | "SINCRONIZADO" | "ERRO";

export const ALL_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "CONFIRMADA",
  "CONCLUIDA",
  "CANCELADA",
  "FALTA",
];
