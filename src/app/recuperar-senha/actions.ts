"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { passwordResetRequestSchema } from "@/lib/validation";
import { RATE_LIMITS } from "@/lib/constants";
import { getClientIp, hitLimit, limitKey, normalizeEmailForLimit } from "@/lib/rate-limit";
import { requestPasswordResetFor } from "@/lib/password-reset";
import { recordAuditCoalesced } from "@/lib/audit-log";
import { securityLog, shortHash } from "@/lib/security-log";

export type RecoverState = { sent?: boolean; error?: string } | null;

/**
 * Pedido de recuperação de senha.
 *  - resposta idêntica para qualquer e-mail (inclusive o tempo: a busca da conta e o envio acontecem DEPOIS da resposta,
 *    em `after()`);
 *  - limite por e-mail normalizado e por IP (este só com proxy confiável declarado), igual para contas que existem ou não;
 *  - nada do e-mail, do token ou do link vai para log ou auditoria.
 * Server Actions já exigem Origin igual ao Host (proteção contra CSRF).
 */
export async function requestPasswordResetAction(_prev: RecoverState, formData: FormData): Promise<RecoverState> {
  const parsed = passwordResetRequestSchema.safeParse({ email: formData.get("email")?.toString() ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Informe um e-mail válido." };
  const { email } = parsed.data;

  const ip = getClientIp(await headers());
  const statuses = await Promise.all([
    hitLimit(limitKey("pwreset-email", normalizeEmailForLimit(email)), RATE_LIMITS.passwordResetEmail),
    ip ? hitLimit(limitKey("pwreset-ip", ip), RATE_LIMITS.passwordResetIp) : null,
  ]);
  const blocked = statuses.find((s) => s?.blocked);
  if (blocked) {
    securityLog("password_reset_blocked", { emailHash: shortHash(email) });
    await recordAuditCoalesced({ action: "password_reset_blocked", result: "BLOQUEADO", subject: email });
    const minutes = Math.max(1, Math.ceil(blocked.retryAfterSeconds / 60));
    return { error: `Muitos pedidos de recuperação. Tente novamente em ${minutes} minuto${minutes > 1 ? "s" : ""}.` };
  }

  // Depois da resposta: busca a conta, gera o token (só o hash vai ao banco) e envia o e-mail. Não lança.
  after(() => requestPasswordResetFor(email));
  return { sent: true };
}
