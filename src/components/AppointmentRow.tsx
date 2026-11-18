import type { ReactNode } from "react";
import { formatCents, formatDateBR, formatTimeBR } from "@/lib/format";
import { formatPlate } from "@/lib/plate";
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
    vehicleBrandSnapshot?: string | null;
    vehicleModelSnapshot?: string | null;
    vehiclePlateSnapshot?: string | null;
    notes?: string | null;
  };
}

// Colunas compartilhadas entre o cabeçalho e as linhas (visíveis a partir de md).
const GRID = "md:grid md:grid-cols-[8rem_minmax(0,1fr)_9rem_minmax(0,1fr)_minmax(0,1fr)_11rem] md:items-center md:gap-x-4";

/** Lista de agendamentos: tabela em telas largas, cartões empilhados no celular (sem rolagem horizontal). */
export function AppointmentList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="table" aria-label={label} className="overflow-hidden md:rounded-2xl md:border md:border-brand/40 md:bg-surface md:shadow-soft">
      <div role="row" className={`hidden border-b border-line bg-surface-2 px-5 py-3 text-xs font-bold uppercase tracking-wide text-fg-muted ${GRID}`}>
        <span role="columnheader">Data e hora</span>
        <span role="columnheader">Cliente</span>
        <span role="columnheader">Celular</span>
        <span role="columnheader">Veículo</span>
        <span role="columnheader">Serviço</span>
        <span role="columnheader">Situação</span>
      </div>
      <ul role="rowgroup" className="space-y-3 md:space-y-0 md:divide-y md:divide-line">
        {children}
      </ul>
    </div>
  );
}

function Cell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="cell" className={`flex items-baseline justify-between gap-3 py-1 md:block md:py-0 ${className}`}>
      <span className="text-xs font-bold uppercase tracking-wide text-fg-muted md:sr-only">{label}</span>
      <div className="min-w-0 text-right md:text-left">{children}</div>
    </div>
  );
}

export function AppointmentRow({ appointment: a }: AppointmentRowProps) {
  const vehicle = [a.vehicleBrandSnapshot, a.vehicleModelSnapshot].filter(Boolean).join(" ");
  return (
    <li
      role="row"
      className={`rounded-2xl border border-line bg-surface p-4 shadow-soft md:rounded-none md:border-0 md:px-5 md:py-4 md:shadow-none ${GRID}`}
    >
      <Cell label="Data e hora">
        <p className="font-display text-xl font-bold leading-tight text-fg">{formatTimeBR(a.startAt)}</p>
        <p className="text-sm text-fg-muted">{formatDateBR(a.startAt)}</p>
      </Cell>
      <Cell label="Cliente">
        <p className="break-words font-semibold text-fg">{a.client.name}</p>
      </Cell>
      <Cell label="Celular">
        <a href={`tel:${a.client.phone.replace(/[^\d+]/g, "")}`} className="text-sm text-fg underline decoration-line-strong underline-offset-4 hover:text-brand">
          {a.client.phone}
        </a>
      </Cell>
      <Cell label="Veículo">
        {vehicle ? (
          <>
            <p className="break-words font-medium text-fg">{vehicle}</p>
            {a.vehiclePlateSnapshot && <p className="text-sm font-bold tracking-wider text-brand">{formatPlate(a.vehiclePlateSnapshot)}</p>}
          </>
        ) : (
          <p className="text-sm text-fg-muted">Não informado</p>
        )}
        {/* Observações da cliente: texto puro (React escapa), curto na lista; completo no detalhe do Google Agenda. */}
        {a.notes && <p className="mt-0.5 line-clamp-2 break-words text-xs text-fg-muted">Obs.: {a.notes}</p>}
      </Cell>
      <Cell label="Serviço">
        <p className="font-medium text-fg">{a.serviceName}</p>
        <p className="text-sm font-semibold text-brand">
          {formatCents(a.priceCents)} <span className="font-normal text-fg-muted">· {a.durationMinutes} min</span>
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
    return <p className="text-xs text-status-confirmed">✓ Sincronizado com o Google Agenda</p>;
  }

  if (status === "ERRO") {
    return (
      <form action={retrySyncAction.bind(null, appointmentId)} className="flex flex-wrap items-center gap-x-2">
        <span className="text-xs font-semibold text-status-danger" title={error ?? undefined}>
          ⚠ Falha ao sincronizar
        </span>
        <button type="submit" className="link text-xs">
          Tentar novamente
        </button>
      </form>
    );
  }

  return <p className="text-xs text-fg-muted">Sincronizando...</p>;
}
