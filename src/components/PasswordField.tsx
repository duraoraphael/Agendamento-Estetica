"use client";

import { useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/icons";

/**
 * Campo de senha com botão "mostrar/ocultar". O rótulo é visível e o erro/dica ficam associados ao campo.
 * O botão tem alvo de toque de 44 px e anuncia o estado (aria-pressed).
 */
export function PasswordField({
  id,
  label,
  error,
  hint,
  ...input
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type">) {
  const [visible, setVisible] = useState(false);
  const describedBy = [error ? `${id}-erro` : null, hint && !error ? `${id}-dica` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className="input pr-12"
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...input}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-0 top-0 flex h-full min-h-[44px] w-11 items-center justify-center rounded-r-lg text-ink/70 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {visible ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
        </button>
      </div>
      {error ? (
        <p id={`${id}-erro`} className="error-text" role="alert">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-dica`} className="hint-text">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
