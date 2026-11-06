import type { InputHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine focus-visible:ring-offset-2 focus-visible:ring-offset-cream";

/** Marca do estúdio: gota de esmalte + faísca dourada. */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="19" fill="#F7E5EB" stroke="#B89160" strokeWidth="1" />
      <path d="M20 8c4.6 6.2 7.5 9.7 7.5 13.6A7.5 7.5 0 0 1 12.5 21.6C12.5 17.7 15.4 14.2 20 8Z" fill="#8B3157" />
      <path d="M17 22.5a3.5 3.5 0 0 0 2.5 3" stroke="#FFF9F6" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M30 9.5v4M28 11.5h4" stroke="#B89160" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Contêiner principal de página: destino do link "Pular para o conteúdo". */
export function Page({ children, width = "md" }: { children: ReactNode; width?: "md" | "lg" | "xl" }) {
  const max = width === "xl" ? "max-w-6xl" : width === "lg" ? "max-w-3xl" : "max-w-xl";
  return (
    <main id="conteudo" className="px-4 py-8 sm:px-6 sm:py-12">
      <div className={`mx-auto ${max}`}>{children}</div>
    </main>
  );
}

export function Notice({
  tone,
  children,
  role,
}: {
  tone: "success" | "error" | "warning";
  children: ReactNode;
  role?: "alert" | "status";
}) {
  const icon = tone === "success" ? "✓" : tone === "error" ? "!" : "i";
  return (
    <div className={`notice-${tone}`} role={role ?? (tone === "error" ? "alert" : "status")}>
      <span
        aria-hidden="true"
        className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full border border-current text-xs font-bold"
      >
        {icon}
      </span>
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-gold/60 bg-white/60 px-6 py-10 text-center">
      <LogoMark className="mx-auto h-10 w-10 opacity-80" />
      <p className="mt-3 font-display text-lg font-semibold text-plum">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-plum-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Campo de formulário com rótulo visível, dica e erro associados ao input. */
export function Field({
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
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id">) {
  const describedBy = [error ? `${id}-erro` : null, hint && !error ? `${id}-dica` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
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

/** Indicador das três etapas do agendamento. */
export function Stepper({ current, serviceId }: { current: 1 | 2 | 3; serviceId?: string }) {
  const steps = [
    { n: 1, label: "Serviço", href: "/agendar" },
    { n: 2, label: "Data e horário", href: serviceId ? `/agendar/horario?serviceId=${serviceId}` : undefined },
    { n: 3, label: "Confirmação", href: undefined },
  ] as const;

  return (
    <nav aria-label="Etapas do agendamento">
      <ol className="flex items-center gap-2 sm:gap-3">
        {steps.map((s, i) => {
          const done = s.n < current;
          const active = s.n === current;
          const content = (
            <>
              <span
                className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-semibold ${
                  active ? "bg-wine text-white" : done ? "bg-gold-soft text-gold-deep" : "border border-plum-line text-plum-muted"
                }`}
                aria-hidden="true"
              >
                {done ? "✓" : s.n}
              </span>
              <span className={`text-xs font-semibold sm:text-sm ${active ? "text-plum" : "hidden text-plum-muted sm:inline"}`}>
                {s.label}
              </span>
              <span className="sr-only">
                {" "}
                — etapa {s.n} de 3{done ? ", concluída" : active ? ", etapa atual" : ""}
              </span>
            </>
          );
          return (
            <li key={s.n} className="flex items-center gap-2 sm:gap-3" aria-current={active ? "step" : undefined}>
              {done && s.href ? (
                <Link href={s.href} className={`flex items-center gap-2 rounded-full ${focusRing}`}>
                  {content}
                </Link>
              ) : (
                <span className="flex items-center gap-2">{content}</span>
              )}
              {i < steps.length - 1 && (
                <span aria-hidden="true" className={`h-px w-4 sm:w-10 ${done ? "bg-gold" : "bg-plum-line/50"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
