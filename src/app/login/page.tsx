"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { Field } from "@/components/ui";
import { safeCallbackPath } from "@/lib/safe-redirect";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Só caminhos do próprio site (evita redirecionamento aberto via ?callbackUrl=https://...).
  const callbackUrl = safeCallbackPath(searchParams.get("callbackUrl"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error === "RATE_LIMITED") {
      setError("Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.");
      return;
    }

    if (!result || result.error) {
      setError("E-mail ou senha incorretos. Verifique os dados e tente novamente.");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle="Acesse sua conta para agendar um horário."
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="link">
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field
          id="email"
          label="E-mail"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          id="password"
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error ?? undefined}
        />

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
