"use server";

import { revalidatePath } from "next/cache";
import { requireClient } from "@/lib/session";
import { prisma } from "@/lib/db";
import { changePasswordSchema, profileSchema, formatZodError } from "@/lib/validation";
import { RATE_LIMITS } from "@/lib/constants";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { recordAuditCoalesced } from "@/lib/audit-log";
import { securityLog } from "@/lib/security-log";
import { changeOwnPassword } from "@/lib/password-reset";

export type AccountState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string> } | null;

/**
 * Edita nome e celular da PRÓPRIA conta. O alvo é sempre o usuário da sessão (nunca um ID do formulário) e só os campos
 * validados entram no `update` (sem mass assignment: e-mail, papel e senha não passam por aqui).
 */
export async function updateProfileAction(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const user = await requireClient();

  const parsed = profileSchema.safeParse({ name: formData.get("name")?.toString() ?? "", phone: formData.get("phone")?.toString() ?? "" });
  if (!parsed.success) return { fieldErrors: formatZodError(parsed.error) };

  const write = await hitLimit(limitKey("account-write-user", user.id), RATE_LIMITS.accountWritesPerMinute, 60_000);
  if (write.blocked) return { error: "Muitos pedidos seguidos. Aguarde um instante e tente novamente." };

  await prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.name, phone: parsed.data.phone } });
  // Auditoria sem nome nem celular: só o ID interno.
  await recordAuditCoalesced({ action: "profile_updated", actorId: user.id }, { windowMs: 60_000, maxDistinctRows: Infinity });

  revalidatePath("/minha-conta");
  return { ok: true };
}

/**
 * Troca de senha logada: exige a senha ATUAL (reautenticação) e limita as tentativas por conta. Ao concluir, sobe a
 * versão da sessão (todas as sessões deixam de valer) e a tela leva ao login.
 */
export async function changePasswordAction(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const user = await requireClient();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword")?.toString() ?? "",
    password: formData.get("password")?.toString() ?? "",
    confirmPassword: formData.get("confirmPassword")?.toString() ?? "",
  });
  if (!parsed.success) return { fieldErrors: formatZodError(parsed.error) };

  const attempt = await hitLimit(limitKey("change-password-user", user.id), RATE_LIMITS.changePassword);
  if (attempt.blocked) {
    securityLog("change_password_blocked", { userId: user.id });
    return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }

  const result = await changeOwnPassword(user.id, parsed.data.currentPassword, parsed.data.password);
  if (!result.ok) return { fieldErrors: { currentPassword: "Senha atual incorreta." } };
  return { ok: true };
}
