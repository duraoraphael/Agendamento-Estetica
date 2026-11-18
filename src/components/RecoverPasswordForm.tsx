"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { requestPasswordResetAction, type RecoverState } from "@/app/recuperar-senha/actions";
import { RECOVER_GENERIC_MESSAGE } from "@/lib/password-reset-text";
import { Field, Notice } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full">
      {pending ? "Enviando..." : "Enviar link"}
    </button>
  );
}

export function RecoverPasswordForm() {
  const [state, formAction] = useFormState<RecoverState, FormData>(requestPasswordResetAction, null);
  // Controlado: o React 19 limpa campos não controlados depois da ação de servidor (ex.: erro de limite).
  const [email, setEmail] = useState("");

  if (state?.sent) {
    return <Notice tone="success">{RECOVER_GENERIC_MESSAGE}</Notice>;
  }

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <Field id="email" name="email" label="E-mail" type="email" required autoComplete="email" placeholder="Seu e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <SubmitButton />
    </form>
  );
}
