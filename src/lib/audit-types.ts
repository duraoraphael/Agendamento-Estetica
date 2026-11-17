/**
 * Vocabulário da trilha de auditoria: categorias (abas da página /admin/logs), resultados e ações conhecidas.
 * Sem dependências de servidor, para poder ser importado por qualquer arquivo.
 *
 * Categorias que NÃO existem porque o site não tem o fluxo correspondente:
 *  - "Entrada" / "Saída" (check-in / check-out): não há registro de chegada ou saída do atendimento. A situação de uma
 *    reserva (CONFIRMADA, CONCLUIDA, CANCELADA, FALTA) é alterada pela administradora e aparece em "Marcação".
 *  - Remarcação: não existe ação de remarcar; só criar e cancelar (e a administradora mudar a situação).
 * Não foram criados fluxos novos só para gerar log.
 */
export const AUDIT_CATEGORIES = ["CADASTRO", "LOGIN", "LOGOUT", "MARCACAO", "ADMIN", "INTEGRACAO"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  CADASTRO: "Cadastro",
  LOGIN: "Login",
  LOGOUT: "Logout",
  MARCACAO: "Marcação",
  ADMIN: "Ações administrativas",
  INTEGRACAO: "Integrações",
};

export const AUDIT_RESULTS = ["SUCESSO", "FALHA", "BLOQUEADO"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const AUDIT_RESULT_LABELS: Record<AuditResult, string> = {
  SUCESSO: "Sucesso",
  FALHA: "Falha",
  BLOQUEADO: "Bloqueado",
};

/** Cada ação pertence a UMA categoria; o rótulo é o que a administradora lê. */
export const AUDIT_ACTIONS = {
  // Cadastro
  signup_created: { category: "CADASTRO", label: "Conta criada" },
  signup_duplicate: { category: "CADASTRO", label: "Cadastro com e-mail já existente" },
  signup_blocked: { category: "CADASTRO", label: "Cadastro bloqueado por excesso de tentativas" },
  // Login
  login_success: { category: "LOGIN", label: "Login realizado" },
  login_failed: { category: "LOGIN", label: "Tentativa de login recusada" },
  login_blocked: { category: "LOGIN", label: "Login bloqueado por excesso de tentativas" },
  // Logout
  logout: { category: "LOGOUT", label: "Saída da conta (logout)" },
  // Marcação
  booking_created: { category: "MARCACAO", label: "Agendamento criado" },
  booking_canceled_by_client: { category: "MARCACAO", label: "Agendamento cancelado pela cliente" },
  booking_status_changed: { category: "MARCACAO", label: "Situação do agendamento alterada" },
  booking_rate_limited: { category: "MARCACAO", label: "Agendamento/cancelamento bloqueado por excesso de pedidos" },
  // Ações administrativas
  service_created: { category: "ADMIN", label: "Serviço criado" },
  service_updated: { category: "ADMIN", label: "Serviço alterado" },
  service_toggled: { category: "ADMIN", label: "Serviço ativado/desativado" },
  business_hours_saved: { category: "ADMIN", label: "Expediente salvo" },
  blocked_period_created: { category: "ADMIN", label: "Bloqueio de horário criado" },
  blocked_period_deleted: { category: "ADMIN", label: "Bloqueio de horário removido" },
  settings_changed: { category: "ADMIN", label: "Configurações do site alteradas" },
  // Integrações (Google Agenda e agendador externo)
  google_connected: { category: "INTEGRACAO", label: "Google Agenda conectado" },
  google_connect_failed: { category: "INTEGRACAO", label: "Falha ao conectar o Google Agenda" },
  google_disconnected: { category: "INTEGRACAO", label: "Google Agenda desconectado" },
  google_retry_sync: { category: "INTEGRACAO", label: "Reenvio de um agendamento ao Google" },
  google_retry_all: { category: "INTEGRACAO", label: "Reenvio de agendamentos com falha ao Google" },
  cron_unauthorized: { category: "INTEGRACAO", label: "Chamada não autorizada ao agendador de sincronização" },
} as const satisfies Record<string, { category: AuditCategory; label: string }>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function isAuditCategory(value: unknown): value is AuditCategory {
  return typeof value === "string" && (AUDIT_CATEGORIES as readonly string[]).includes(value);
}

export function isAuditResult(value: unknown): value is AuditResult {
  return typeof value === "string" && (AUDIT_RESULTS as readonly string[]).includes(value);
}

/** Rótulo de uma ação gravada; ações desconhecidas (de versões futuras) aparecem pelo código, nunca quebram a página. */
export function auditActionLabel(action: string): string {
  return (AUDIT_ACTIONS as Record<string, { label: string }>)[action]?.label ?? action;
}
