"use client";

import { useFormState, useFormStatus } from "react-dom";
import { resetPasswordAction, type ResetState } from "@/app/redefinir-senha/actions";
import { Notice } from "@/components/ui";
import { PasswordField } from "@/components/PasswordField";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full">
      {pending ? "Salvando..." : "Redefinir senha"}
    </button>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useFormState<ResetState, FormData>(resetPasswordAction, null);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <PasswordField id="password" name="password" label="Nova senha" required autoComplete="new-password" error={errors.password} hint="Pelo menos 8 caracteres, sem ser uma senha muito comum." />
      <PasswordField id="confirmPassword" name="confirmPassword" label="Confirmar nova senha" required autoComplete="new-password" error={errors.confirmPassword} />
      <SubmitButton />
    </form>
  );
}
