"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { Field, Notice } from "@/components/ui";
import { PasswordField } from "@/components/PasswordField";
import { GoogleSignIn } from "@/components/GoogleSignIn";
import { safeCallbackPath } from "@/lib/safe-redirect";

function LoginForm() {
  const searchParams = useSearchParams();
  // Só caminhos do próprio site (evita redirecionamento aberto via ?callbackUrl=https://...).
  const callbackUrl = safeCallbackPath(searchParams.get("callbackUrl"));
  // A intenção (ex.: "agendar este serviço neste horário") acompanha a pessoa até o cadastro e de volta.
  const carry = callbackUrl !== "/" ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : "";
  const passwordChanged = searchParams.get("senha") === "alterada";
  const authError = searchParams.get("error");
  const googleError = authError === "GoogleRateLimited"
    ? "Muitas tentativas com o Google. Aguarde alguns minutos e tente novamente."
    : authError && /^(OAuth\w*|AccessDenied)$/.test(authError)
      ? "Não foi possível entrar com o Google. Se você já tem cadastro, entre com e-mail e senha e vincule o Google em Minha conta."
      : null;

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
      callbackUrl,
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

    // Solicita a página com a sessão recém-emitida, sem reutilizar uma navegação feita como visitante.
    window.location.assign(callbackUrl);
  }

  return (
    <AuthShell
      accent="Entrar"
      subtitle="Acesse sua conta Garage Zero Zero."
      photo="hero"
      footer={null}
    >
      {googleError && <div className="mb-4"><Notice tone="error">{googleError}</Notice></div>}
      <GoogleSignIn callbackUrl={callbackUrl} />
      <form onSubmit={handleSubmit} className="space-y-5">
        {passwordChanged && <Notice tone="success">Senha alterada. Entre com a nova senha.</Notice>}
        <Field
          id="email"
          label="E-mail"
          type="email"
          autoComplete="email"
          placeholder="Seu e-mail"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          id="password"
          label="Senha"
          autoComplete="current-password"
          placeholder="Sua senha"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error ?? undefined}
        />

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/recuperar-senha" className="link inline-flex min-h-[44px] items-center">
            Esqueci minha senha
          </Link>
          <Link href={`/cadastro${carry}`} className="link inline-flex min-h-[44px] items-center">
            Criar conta
          </Link>
        </div>
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
