import type { InputHTMLAttributes, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { LOGO } from "@/lib/site";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

/** Logo oficial da Garage Zero Zero em formato circular (arquivo fornecido, sem alterações). Decorativa: `alt` vazio. */
export function LogoMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <Image
      src={LOGO.src}
      alt=""
      width={LOGO.width}
      height={LOGO.height}
      unoptimized
      className={`flex-none rounded-full border border-brand/60 object-cover ${className}`}
    />
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

/** Título de página: texto em off-white com palavras-chave em amarelo e filete decorativo. */
export function PageHeader({ title, accent, subtitle }: { title?: string; accent: string; subtitle?: ReactNode }) {
  return (
    <header>
      <h1 className="page-title">
        {title ? `${title} ` : ""}
        <span className="accent">{accent}</span>
      </h1>
      <div className="accent-rule mt-3" aria-hidden="true" />
      {subtitle && <p className="mt-3 text-fg-muted">{subtitle}</p>}
    </header>
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
    <div className="rounded-2xl border border-dashed border-brand/60 bg-surface/60 px-6 py-10 text-center">
      <LogoMark className="mx-auto h-12 w-12 opacity-90" />
      <p className="mt-3 font-display text-xl font-bold uppercase tracking-wide text-fg">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">{children}</p>}
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

export type StepNumber = 1 | 2 | 3 | 4;

/** Indicador das quatro etapas do agendamento: serviço, data e horário, veículo, revisão. */
export function Stepper({ current, serviceId, startAt }: { current: StepNumber; serviceId?: string; startAt?: string }) {
  const horario = serviceId ? `/agendar/horario?${new URLSearchParams({ serviceId }).toString()}` : undefined;
  const veiculo = serviceId && startAt ? `/agendar/veiculo?${new URLSearchParams({ serviceId, startAt }).toString()}` : undefined;
  const steps = [
    { n: 1, label: "Serviço", href: "/agendar" },
    { n: 2, label: "Data e horário", href: horario },
    { n: 3, label: "Veículo", href: veiculo },
    { n: 4, label: "Revisão", href: undefined },
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
                className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-bold ${
                  active ? "bg-brand text-ink" : done ? "bg-brand/20 text-brand" : "border border-line-strong text-fg-muted"
                }`}
                aria-hidden="true"
              >
                {done ? "✓" : s.n}
              </span>
              <span className={`text-xs font-semibold sm:text-sm ${active ? "text-fg" : "hidden text-fg-muted sm:inline"}`}>
                {s.label}
              </span>
              <span className="sr-only">
                {" "}
                — etapa {s.n} de 4{done ? ", concluída" : active ? ", etapa atual" : ""}
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
                <span aria-hidden="true" className={`h-px w-4 sm:w-8 ${done ? "bg-brand" : "bg-line-strong/50"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
