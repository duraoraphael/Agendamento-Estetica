import type { ReactNode } from "react";
import { formatCents, formatDateBR, formatTimeBR } from "@/lib/format";
import { StatusSelect } from "@/components/StatusSelect";
import { retrySyncAction } from "@/app/admin/agendamentos/actions";
import type { AppointmentStatus, GoogleSyncStatus } from "@/lib/types";

interface AppointmentRowProps {
  appointment: {
    id: string;
    startAt: Date;
    serviceName: string;
    priceCents: number;
    durationMinutes: number;
    status: string;
    googleSyncStatus: string;
    googleSyncError: string | null;
    client: { name: string; phone: string };
  };
}

// Colunas compartilhadas entre o cabeçalho e as linhas (visíveis a partir de md).
const GRID = "md:grid md:grid-cols-[9.5rem_minmax(0,1.2fr)_9.5rem_minmax(0,1fr)_11rem] md:items-center md:gap-x-4";

/** Lista de agendamentos: tabela em telas largas, cartões empilhados no celular (sem rolagem horizontal). */
export function AppointmentList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="table" aria-label={label} className="overflow-hidden md:rounded-2xl md:border md:border-neutral-line md:bg-white md:shadow-soft">
      <div role="row" className={`hidden border-b border-neutral-line bg-blush-light px-5 py-3 text-xs font-semibold uppercase tracking-wide text-plum-muted ${GRID}`}>
        <span role="columnheader">Data e hora</span>
        <span role="columnheader">Cliente</span>
        <span role="columnheader">Celular</span>
        <span role="columnheader">Serviço</span>
        <span role="columnheader">Situação</span>
      </div>
      <ul role="rowgroup" className="space-y-3 md:space-y-0 md:divide-y md:divide-neutral-line">
        {children}
      </ul>
    </div>
  );
}

function Cell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="cell" className={`flex items-baseline justify-between gap-3 py-1 md:block md:py-0 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-plum-muted md:sr-only">{label}</span>
      <div className="text-right md:text-left">{children}</div>
    </div>
  );
}

export function AppointmentRow({ appointment: a }: AppointmentRowProps) {
  return (
    <li
      role="row"
      className={`rounded-2xl border border-neutral-line bg-white p-4 shadow-soft md:rounded-none md:border-0 md:px-5 md:py-4 md:shadow-none ${GRID}`}
    >
      <Cell label="Data e hora">
        <p className="font-display text-lg font-semibold leading-tight text-plum">{formatTimeBR(a.startAt)}</p>
        <p className="text-sm text-plum-muted">{formatDateBR(a.startAt)}</p>
      </Cell>
      <Cell label="Cliente">
        <p className="font-semibold text-plum">{a.client.name}</p>
      </Cell>
      <Cell label="Celular">
        <a href={`tel:${a.client.phone.replace(/[^\d+]/g, "")}`} className="text-sm text-plum underline decoration-plum-line underline-offset-4 hover:text-wine">
          {a.client.phone}
        </a>
      </Cell>
      <Cell label="Serviço">
        <p className="font-medium text-plum">{a.serviceName}</p>
        <p className="text-sm font-semibold text-wine">
          {formatCents(a.priceCents)} <span className="font-normal text-plum-muted">· {a.durationMinutes} min</span>
        </p>
      </Cell>
      <Cell label="Situação" className="md:flex-col">
        <div className="space-y-1.5">
          <StatusSelect appointmentId={a.id} status={a.status as AppointmentStatus} clientName={a.client.name} />
          <GoogleSyncIndicator appointmentId={a.id} status={a.googleSyncStatus as GoogleSyncStatus} error={a.googleSyncError} />
        </div>
      </Cell>
    </li>
  );
}

function GoogleSyncIndicator({
  appointmentId,
  status,
  error,
}: {
  appointmentId: string;
  status: GoogleSyncStatus;
  error: string | null;
}) {
  if (status === "NAO_CONECTADO") return null;

  if (status === "SINCRONIZADO") {
    return <p className="text-xs text-status-done">✓ Sincronizado com o Google Agenda</p>;
  }

  if (status === "ERRO") {
    return (
      <form action={retrySyncAction.bind(null, appointmentId)} className="flex flex-wrap items-center gap-x-2">
        <span className="text-xs font-medium text-status-danger" title={error ?? undefined}>
          ⚠ Falha ao sincronizar
        </span>
        <button type="submit" className="link text-xs">
          Tentar novamente
        </button>
      </form>
    );
  }

  return <p className="text-xs text-plum-muted">Sincronizando...</p>;
}
