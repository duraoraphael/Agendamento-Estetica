"use client";

import { useState, useTransition } from "react";
import { changeStatusAction } from "@/app/admin/agendamentos/actions";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/constants";
import type { AppointmentStatus } from "@/lib/types";

const OPTIONS: AppointmentStatus[] = ["CONFIRMADA", "CONCLUIDA", "CANCELADA", "FALTA"];

export function StatusSelect({
  appointmentId,
  status,
  clientName,
}: {
  appointmentId: string;
  status: AppointmentStatus;
  clientName?: string;
}) {
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleChange(next: AppointmentStatus) {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await changeStatusAction(appointmentId, next);
      if (!result.ok) {
        // Mantém a situação anterior e explica o motivo (ex.: horário já ocupado).
        setValue(previous);
        setError(result.error);
        return;
      }
      // Sem router.refresh(): changeStatusAction já revalida Hoje, Agendamentos e Faturamento na mesma ida ao servidor.
    });
  }

  return (
    <>
    <select
      value={value}
      disabled={pending}
      aria-label={clientName ? `Situação do atendimento de ${clientName}` : "Situação do atendimento"}
      onChange={(e) => handleChange(e.target.value as AppointmentStatus)}
      className={`min-h-[44px] w-full cursor-pointer rounded-full border-0 px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine disabled:opacity-60 md:min-h-[40px] ${
        STATUS_BADGE_CLASSES[value] ?? ""
      }`}
    >
      {OPTIONS.map((opt) => (
        <option key={opt} value={opt} className="bg-white text-plum">
          {STATUS_LABELS[opt]}
        </option>
      ))}
    </select>
    {error && (
      <p role="alert" className="mt-1.5 text-xs font-medium text-status-danger">
        {error}
      </p>
    )}
    </>
  );
}
