"use client";

import { useState, useTransition } from "react";
import { cancelOwnBookingAction } from "@/app/meus-agendamentos/actions";

/** Cancelamento em duas etapas (botão → confirmação), para evitar toque acidental no celular. */
export function CancelBookingButton({ appointmentId, policyText }: { appointmentId: string; policyText: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelOwnBookingAction(appointmentId);
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      // Sem router.refresh(): a própria Server Action já revalida as telas afetadas na mesma ida ao servidor.
    });
  }

  return (
    <div className="mt-6 rounded-2xl border border-blush-deep/60 bg-white p-5">
      <p className="text-sm text-plum-muted">{policyText}</p>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-status-danger">
          {error}
        </p>
      )}

      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="btn-secondary mt-4 w-full sm:w-auto">
          Cancelar agendamento
        </button>
      ) : (
        <div className="mt-4 space-y-3" role="group" aria-label="Confirmar cancelamento">
          <p className="text-sm font-semibold text-plum">Tem certeza? O horário será liberado para outras clientes.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={cancel} disabled={pending} className="btn-primary w-full sm:w-auto">
              {pending ? "Cancelando..." : "Sim, cancelar"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="btn-ghost w-full sm:w-auto">
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
