import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { Notice } from "@/components/ui";
import { isResetTokenUsable } from "@/lib/password-reset";

// O link carrega o token na URL: nada de Referer para outros sites e nada de indexação.
export const metadata = { title: "Redefinir senha", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function RedefinirSenhaPage({ searchParams: searchParamsPromise }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParamsPromise;
  const usable = typeof token === "string" && (await isResetTokenUsable(token));

  return (
    <AuthShell
      accent="Redefinir senha"
      subtitle="Escolha uma nova senha para a sua conta."
      photo="hero"
      footer={
        <p>
          <Link href="/login" className="link">
            Voltar para entrar
          </Link>
        </p>
      }
    >
      {usable && token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-4">
          <Notice tone="warning">Este link é inválido, expirou ou já foi usado.</Notice>
          <Link href="/recuperar-senha" className="btn-primary w-full">
            Pedir um novo link
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
