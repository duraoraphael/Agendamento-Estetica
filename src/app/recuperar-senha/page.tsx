import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { RecoverPasswordForm } from "@/components/RecoverPasswordForm";

export const metadata = { title: "Recuperar senha" };

export default function RecuperarSenhaPage() {
  return (
    <AuthShell
      accent="Recuperar senha"
      subtitle="Informe seu e-mail para receber um link de redefinição de senha."
      photo="hero"
      footer={
        <p>
          Lembrou a senha?{" "}
          <Link href="/login" className="link">
            Entrar
          </Link>
        </p>
      }
    >
      <RecoverPasswordForm />
    </AuthShell>
  );
}
