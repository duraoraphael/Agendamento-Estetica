/**
 * Envio de e-mail transacional (hoje: só a recuperação de senha). Abstração mínima e configurável por ambiente:
 *
 *   MAIL_PROVIDER = "none"   (padrão) não envia nada. Registra APENAS que um e-mail deixou de ser enviado, sem
 *                            destinatário, assunto, corpo nem link. A recuperação de senha fica inoperante até um
 *                            provedor ser configurado, e o token NUNCA aparece na tela nem nos logs.
 *   MAIL_PROVIDER = "resend" envia pela API HTTPS do Resend (sem dependência nova). Exige RESEND_API_KEY e MAIL_FROM
 *                            (ex.: "Garage Zero Zero <nao-responda@seudominio.com.br>", domínio verificado no Resend).
 *
 * Para usar outro provedor (SMTP, SES...), implemente `MailTransport` abaixo e registre em `transports`.
 * Nada aqui lança por falha de rede: quem chama decide o que fazer com `{ ok: false }` (a recuperação de senha ignora a
 * falha, para a resposta ao usuário não revelar se a conta existe).
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  ok: boolean;
}

export type MailTransport = (message: MailMessage) => Promise<MailResult>;

const SEND_TIMEOUT_MS = 10_000;

const noneTransport: MailTransport = async () => {
  // Sem destinatário, assunto, corpo ou link: o corpo do e-mail de recuperação carrega o token.
  console.warn(JSON.stringify({ kind: "mail", event: "not_sent", provider: "none" }));
  return { ok: false };
};

const resendTransport: MailTransport = async (message) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from) {
    console.error(JSON.stringify({ kind: "mail", event: "misconfigured", provider: "resend" }));
    return { ok: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}) }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    // Só o status HTTP vai para o log: nunca o corpo da resposta nem da requisição.
    if (!res.ok) console.error(JSON.stringify({ kind: "mail", event: "send_failed", provider: "resend", status: res.status }));
    return { ok: res.ok };
  } catch {
    console.error(JSON.stringify({ kind: "mail", event: "send_error", provider: "resend" }));
    return { ok: false };
  }
};

const transports: Record<string, MailTransport> = { none: noneTransport, resend: resendTransport };

// Troca do transporte em testes (nunca em produção).
let override: MailTransport | null = null;
export function __setMailTransportForTests(transport: MailTransport | null) {
  override = transport;
}

export function mailProviderName(): string {
  const name = (process.env.MAIL_PROVIDER ?? "none").trim().toLowerCase();
  return name in transports ? name : "none";
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const transport = override ?? transports[mailProviderName()];
  try {
    return await transport(message);
  } catch {
    return { ok: false };
  }
}
