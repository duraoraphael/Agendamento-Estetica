import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { readGoogleSignup } from "@/lib/google-auth";
import { GoogleSignupForm } from "./GoogleSignupForm";

export const metadata = { title: "Completar cadastro" };

export default async function CompleteSignupPage() {
  const pending = await readGoogleSignup();
  if (!pending) redirect("/login");

  const loginUrl = `/login?callbackUrl=${encodeURIComponent(pending.callbackPath)}`;
  return (
    <AuthShell
      accent="Completar cadastro"
      subtitle={`Informe seu WhatsApp para agendar com a conta ${pending.identity.email}.`}
      footer={<Link href={loginUrl} className="link">Voltar ao login</Link>}
    >
      <GoogleSignupForm callbackUrl={pending.callbackPath} loginUrl={loginUrl} />
    </AuthShell>
  );
}
