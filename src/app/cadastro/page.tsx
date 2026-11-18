"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Field, Notice } from "@/components/ui";
import { PasswordField } from "@/components/PasswordField";
import { safeCallbackPath } from "@/lib/safe-redirect";

type FieldErrors = Record<string, string>;

const FIELD_ORDER = ["name", "phone", "email", "password", "confirmPassword", "consent"] as const;

function CadastroForm() {
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackPath(searchParams.get("callbackUrl"));
  const carry = callbackUrl !== "/" ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : "";

  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Leva o foco ao primeiro campo com erro para quem usa teclado ou leitor de tela.
  useEffect(() => {
    const first = FIELD_ORDER.find((f) => errors[f]);
    if (first) formRef.current?.querySelector<HTMLInputElement>(`#${first}`)?.focus();
  }, [errors]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setLoading(true);

    try {
      const res = await fetch("/api/auth/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, consent }),
      });
      const data = await res.json();

      if (!data.ok) {
        setErrors(data.errors || { _form: "Não foi possível concluir o cadastro." });
        setLoading(false);
        return;
      }

      // Resposta igual para e-mail novo e já cadastrado (evita revelar quem tem conta):
      // não entramos automaticamente; a cliente usa "Entrar" com a senha escolhida.
      setDone(data.message ?? "Cadastro recebido. Agora é só entrar.");
      setLoading(false);
    } catch {
      setErrors({ _form: "Não foi possível concluir o cadastro. Verifique sua conexão e tente novamente." });
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthShell accent="Quase lá" subtitle="Seu cadastro foi recebido." photo="hero" footer={null}>
        <div className="space-y-5">
          <Notice tone="success">{done}</Notice>
          <Link href={`/login${carry}`} className="btn-primary w-full">
            Entrar
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      accent="Criar conta"
      subtitle="Crie sua conta e agende seus serviços com praticidade."
      photo="hero"
      footer={
        <p>
          Já tem conta?{" "}
          <Link href={`/login${carry}`} className="link">
            Entrar
          </Link>
        </p>
      }
    >
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
        {errors._form && <Notice tone="error">{errors._form}</Notice>}

        <Field id="name" label="Nome completo" required autoComplete="name" placeholder="Seu nome completo" value={form.name} onChange={(e) => update("name", e.target.value)} error={errors.name} />
        <Field
          id="phone"
          label="WhatsApp / celular com DDD"
          required
          placeholder="(11) 90000-0000"
          autoComplete="tel"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => update("phone", e.target.value)}
          error={errors.phone}
        />
        <Field id="email" label="E-mail" type="email" required autoComplete="email" placeholder="Seu e-mail" value={form.email} onChange={(e) => update("email", e.target.value)} error={errors.email} />
        <PasswordField
          id="password"
          label="Senha"
          required
          autoComplete="new-password"
          placeholder="Crie uma senha"
          value={form.password}
          onChange={(e) => update("password", e.target.value)}
          error={errors.password}
          hint="Pelo menos 8 caracteres, sem ser uma senha muito comum."
        />
        <PasswordField
          id="confirmPassword"
          label="Confirmar senha"
          required
          autoComplete="new-password"
          placeholder="Repita a senha"
          value={form.confirmPassword}
          onChange={(e) => update("confirmPassword", e.target.value)}
          error={errors.confirmPassword}
        />

        <div>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-fg" htmlFor="consent">
            <input
              id="consent"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={errors.consent ? "consent-erro" : "consent-dica"}
              className="mt-0.5 h-5 w-5 flex-none accent-brand"
            />
            <span>
              Concordo que a Garage Zero Zero use meu nome, e-mail, WhatsApp e os dados do meu veículo para realizar e confirmar meus agendamentos e para falar comigo sobre eles.
            </span>
          </label>
          {errors.consent ? (
            <p id="consent-erro" className="error-text" role="alert">
              <span aria-hidden="true">⚠</span>
              {errors.consent}
            </p>
          ) : (
            <p id="consent-dica" className="hint-text">
              Coletamos só o necessário, não vendemos seus dados e você pode pedir a correção ou a exclusão a qualquer momento (LGPD).
            </p>
          )}
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Criando conta..." : "Criar conta"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function CadastroPage() {
  return (
    <Suspense>
      <CadastroForm />
    </Suspense>
  );
}
