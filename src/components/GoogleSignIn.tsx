"use client";

import { useEffect, useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import Image from "next/image";
import { Notice } from "@/components/ui";

export function GoogleSignIn({ callbackUrl, label = "Continuar com Google" }: { callbackUrl: string; label?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void getProviders().then((providers) => {
      if (active) setEnabled(Boolean(providers?.google));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  if (!enabled) return null;

  async function continueWithGoogle() {
    setFailed(false);
    setLoading(true);
    try {
      await signIn("google", { callbackUrl });
    } catch {
      setFailed(true);
      setLoading(false);
    }
  }

  return (
    <div className="mb-6 space-y-3 border-b border-line pb-6">
      <button type="button" className="btn-google" disabled={loading} onClick={continueWithGoogle}>
        <Image src="/google-g.png" alt="" width={20} height={20} />
        <span>{loading ? "Abrindo o Google..." : label}</span>
      </button>
      {failed && <Notice tone="error">Não foi possível abrir o Google. Tente novamente.</Notice>}
    </div>
  );
}
