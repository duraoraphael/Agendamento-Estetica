"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Field, Notice } from "@/components/ui";
import { LIMITS } from "@/lib/limits";

export function GoogleSignupForm({ callbackUrl, loginUrl }: { callbackUrl: string; loginUrl: string }) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setFailed(false);
    try {
      const result = await signIn("google-cadastro", {
        phone: form.get("phone"),
        consent: form.get("consent") ? "true" : "false",
        callbackUrl,
        redirect: false,
      });
      if (result?.ok && !result.error) {
        window.location.assign(callbackUrl);
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    }
    setLoading(false);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {failed && (
        <Notice tone="error">
          Não foi possível concluir. Confira o WhatsApp ou <Link href={loginUrl} className="link">entre com o Google novamente</Link>.
        </Notice>
      )}
      <Field
        id="phone"
        name="phone"
        label="WhatsApp / celular com DDD"
        type="tel"
        autoComplete="tel"
        placeholder="(11) 90000-0000"
        maxLength={LIMITS.phoneMax}
        required
      />
      <label htmlFor="google-signup-consent" className="flex cursor-pointer items-start gap-3 text-sm text-fg">
        <input id="google-signup-consent" name="consent" type="checkbox" required className="mt-0.5 h-5 w-5 flex-none accent-brand" />
        <span>
          Concordo que a Garage Zero Zero use meu nome, e-mail, WhatsApp e os dados do meu veículo para realizar e confirmar meus agendamentos e para falar comigo sobre eles.
        </span>
      </label>
      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "Criando conta..." : "Concluir cadastro"}
      </button>
    </form>
  );
}
