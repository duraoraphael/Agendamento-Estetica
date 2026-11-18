"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { updateProfileAction, type AccountState } from "@/app/minha-conta/actions";
import { Field, Notice } from "@/components/ui";
import { PencilIcon } from "@/components/icons";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full sm:w-auto">
      {pending ? "Salvando..." : "Salvar"}
    </button>
  );
}

/**
 * Dados pessoais da conta. Só NOME e CELULAR são editáveis aqui. O e-mail e a senha são dados de acesso: mudam por
 * fluxos que exigem reautenticação (senha atual) ou verificação, nunca por este formulário.
 */
export function ProfileForm({ name, email, phone }: { name: string; email: string; phone: string }) {
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(name);
  const [phoneValue, setPhoneValue] = useState(phone);
  const [state, formAction] = useFormState<AccountState, FormData>(updateProfileAction, null);
  const errors = state?.fieldErrors ?? {};

  // Salvou: volta para a visualização.
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (!editing) {
    return (
      <div>
        {state?.ok && (
          <div className="mb-4">
            <Notice tone="success">Dados atualizados.</Notice>
          </div>
        )}
        <dl className="divide-y divide-line">
          <div className="py-3">
            <dt className="text-xs font-bold text-fg-muted">Nome completo</dt>
            <dd className="mt-0.5 text-fg">{name}</dd>
          </div>
          <div className="py-3">
            <dt className="text-xs font-bold text-fg-muted">E-mail</dt>
            <dd className="mt-0.5 break-all text-fg">{email}</dd>
          </div>
          <div className="py-3">
            <dt className="text-xs font-bold text-fg-muted">WhatsApp</dt>
            <dd className="mt-0.5 text-fg">{phone}</dd>
          </div>
        </dl>
        <button type="button" onClick={() => setEditing(true)} className="btn-secondary mt-3 w-full">
          <PencilIcon className="h-5 w-5" /> Editar dados
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {/* Controlados: o React 19 limpa campos não controlados depois da ação de servidor, e um erro apagaria o que foi digitado. */}
      <Field id="name" name="name" label="Nome completo" required autoComplete="name" value={nameValue} onChange={(e) => setNameValue(e.target.value)} error={errors.name} />
      <Field id="phone" name="phone" label="WhatsApp / celular com DDD" required inputMode="tel" autoComplete="tel" value={phoneValue} onChange={(e) => setPhoneValue(e.target.value)} error={errors.phone} />
      <div>
        <label className="label" htmlFor="email-readonly">
          E-mail
        </label>
        <input id="email-readonly" className="input opacity-70" value={email} readOnly aria-describedby="email-dica" />
        <p id="email-dica" className="hint-text">
          Para trocar o e-mail da conta, fale com a Garage Zero Zero (a troca exige confirmação de identidade).
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <SaveButton />
        <button type="button" onClick={() => setEditing(false)} className="btn-ghost w-full sm:w-auto">
          Cancelar
        </button>
      </div>
    </form>
  );
}
