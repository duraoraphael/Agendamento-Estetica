"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { signOut } from "next-auth/react";
import { changePasswordAction, type AccountState } from "@/app/minha-conta/actions";
import { Notice } from "@/components/ui";
import { PasswordField } from "@/components/PasswordField";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-secondary w-full sm:w-auto">
      {pending ? "Alterando..." : "Alterar senha"}
    </button>
  );
}

/**
 * Troca de senha com a conta aberta. Exige a SENHA ATUAL (reautenticação). Ao concluir, todas as sessões (inclusive
 * esta) deixam de valer no servidor, e a cliente entra de novo com a senha nova.
 */
export function ChangePasswordForm() {
  const [state, formAction] = useFormState<AccountState, FormData>(changePasswordAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state?.fieldErrors ?? {};

  useEffect(() => {
    if (state?.ok) void signOut({ callbackUrl: "/login?senha=alterada" });
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && <Notice tone="success">Senha alterada. Redirecionando para o login...</Notice>}
      <PasswordField id="currentPassword" name="currentPassword" label="Senha atual" required autoComplete="current-password" error={errors.currentPassword} />
      <PasswordField id="password" name="password" label="Nova senha" required autoComplete="new-password" error={errors.password} hint="Pelo menos 8 caracteres, sem ser uma senha muito comum." />
      <PasswordField id="confirmPassword" name="confirmPassword" label="Confirmar nova senha" required autoComplete="new-password" error={errors.confirmPassword} />
      <SubmitButton />
    </form>
  );
}
