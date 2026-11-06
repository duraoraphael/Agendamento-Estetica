"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { Field, Notice } from "@/components/ui";

type FieldErrors = Record<string, string>;

const FIELD_ORDER = ["name", "email", "phone", "password", "confirmPassword"] as const;

export default function CadastroPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
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
        body: JSON.stringify(form),
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
      <AuthShell title="Quase lá" subtitle="Seu cadastro foi recebido." footer={null}>
        <div className="space-y-5">
          <Notice tone="success">{done}</Notice>
          <Link href="/login" className="btn-primary w-full">
            Entrar
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Leva menos de um minuto."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/login" className="link">
            Entrar
          </Link>
        </>
      }
    >
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
        {errors._form && <Notice tone="error">{errors._form}</Notice>}

        <Field id="name" label="Nome completo" required autoComplete="name" value={form.name} onChange={(e) => update("name", e.target.value)} error={errors.name} />
        <Field id="email" label="E-mail" type="email" required autoComplete="email" value={form.email} onChange={(e) => update("email", e.target.value)} error={errors.email} />
        <Field
          id="phone"
          label="Celular com DDD"
          required
          placeholder="(11) 90000-0000"
          autoComplete="tel"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => update("phone", e.target.value)}
          error={errors.phone}
        />
        <Field
          id="password"
          label="Senha"
          type="password"
          required
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => update("password", e.target.value)}
          error={errors.password}
          hint="Pelo menos 8 caracteres, sem ser uma senha muito comum."
        />
        <Field
          id="confirmPassword"
          label="Confirmar senha"
          type="password"
          required
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={(e) => update("confirmPassword", e.target.value)}
          error={errors.confirmPassword}
        />

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Criando conta..." : "Criar conta"}
        </button>
      </form>
    </AuthShell>
  );
}
