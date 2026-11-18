"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { formatZodError, passwordResetSchema } from "@/lib/validation";
import { RATE_LIMITS } from "@/lib/constants";
import { getClientIp, hitLimit, limitKey } from "@/lib/rate-limit";
import { hashResetToken, redeemResetToken } from "@/lib/password-reset";
import { recordAuditCoalesced } from "@/lib/audit-log";
import { securityLog } from "@/lib/security-log";

export type ResetState = { error?: string; fieldErrors?: Record<string, string> } | null;

const INVALID_LINK = "Este link é inválido, expirou ou já foi usado. Peça um novo link de recuperação.";

/**
 * Define a nova senha com o link recebido por e-mail.
 *  - política de senha do cadastro (`passwordSchema`), validada no servidor;
 *  - tentativas limitadas por IP (proxy confiável) e por link, antes de qualquer custo de bcrypt;
 *  - o link é de USO ÚNICO e atômico (veja redeemResetToken); ao concluir, todas as sessões da conta deixam de valer;
 *  - o token nunca é registrado: só o hash curto do link entra no limitador (chave), nunca em log ou auditoria.
 */
export async function resetPasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = passwordResetSchema.safeParse({
    token: formData.get("token")?.toString() ?? "",
    password: formData.get("password")?.toString() ?? "",
    confirmPassword: formData.get("confirmPassword")?.toString() ?? "",
  });
  if (!parsed.success) {
    const errors = formatZodError(parsed.error);
    // Erro no token aparece como aviso geral (o campo não é visível).
    if (errors.token) return { error: INVALID_LINK };
    return { fieldErrors: errors };
  }
  const { token, password } = parsed.data;

  const ip = getClientIp(await headers());
  const statuses = await Promise.all([
    hitLimit(limitKey("pwreset-redeem-token", hashResetToken(token)), RATE_LIMITS.passwordResetRedeemToken),
    ip ? hitLimit(limitKey("pwreset-redeem-ip", ip), RATE_LIMITS.passwordResetRedeemIp) : null,
  ]);
  if (statuses.some((s) => s?.blocked)) {
    securityLog("password_reset_redeem_blocked", {});
    return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }

  const result = await redeemResetToken(token, password);
  if (!result.ok) {
    await recordAuditCoalesced({ action: "password_reset_invalid", result: "FALHA" });
    return { error: INVALID_LINK };
  }

  redirect("/login?senha=alterada");
}
