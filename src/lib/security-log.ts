import crypto from "node:crypto";

/**
 * Registro estruturado de eventos de segurança: UMA linha JSON por evento, pronta para ser coletada
 * pelo provedor de hospedagem. NUNCA recebe e-mail, celular, nome, senha ou token: identificadores
 * de pessoa entram só como hash curto (`shortHash`) ou como ID interno.
 */
export type SecurityEvent =
  | "login_blocked"
  | "login_failed"
  | "admin_login"
  | "signup_blocked"
  | "slots_rate_limited"
  | "booking_rate_limited"
  | "admin_status_changed"
  | "cron_unauthorized"
  | "settings_changed"
  | "settings_rate_limited"
  | "logo_rejected";

export function shortHash(value: string): string {
  return crypto.createHash("sha256").update(value.normalize("NFKC").trim().toLowerCase()).digest("hex").slice(0, 12);
}

export function securityLog(event: SecurityEvent, fields: Record<string, string | number | boolean | null> = {}): void {
  console.warn(JSON.stringify({ ts: new Date().toISOString(), kind: "security", event, ...fields }));
}
