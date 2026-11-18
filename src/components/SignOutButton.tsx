"use client";

import { signOut } from "next-auth/react";

/** Encerra a sessão neste aparelho e volta ao início. */
export function SignOutButton({ className = "btn-secondary" }: { className?: string }) {
  return (
    <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className={className}>
      Encerrar sessão
    </button>
  );
}
