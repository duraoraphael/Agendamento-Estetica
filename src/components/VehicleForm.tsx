"use client";

import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { createVehicleAction, deleteVehicleAction, updateVehicleAction, type VehicleFormState } from "@/app/minha-conta/veiculos/actions";
import { Notice } from "@/components/ui";
import { VehicleFields, type VehicleDefaults } from "@/components/VehicleFields";

function SubmitButton({ edit }: { edit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full sm:w-auto">
      {pending ? "Salvando..." : edit ? "Salvar alterações" : "Cadastrar veículo"}
    </button>
  );
}

/** Cadastro e edição de veículo. A dona do veículo é SEMPRE a da sessão: o servidor ignora qualquer `userId` do formulário. */
export function VehicleForm({ vehicleId, defaults }: { vehicleId?: string; defaults?: VehicleDefaults }) {
  const edit = Boolean(vehicleId);
  const [state, formAction] = useFormState<VehicleFormState, FormData>(edit ? updateVehicleAction : createVehicleAction, null);

  return (
    <form action={formAction} className="space-y-6">
      {vehicleId && <input type="hidden" name="vehicleId" value={vehicleId} />}
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <VehicleFields defaults={defaults} errors={state?.fieldErrors} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <SubmitButton edit={edit} />
        <Link href="/minha-conta/veiculos" className="btn-ghost w-full sm:w-auto">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

/** Remoção em duas etapas. As reservas já feitas continuam com os dados do veículo copiados (histórico intacto). */
export function DeleteVehicleButton({ vehicleId }: { vehicleId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteVehicleAction(vehicleId);
      if (result?.error) {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-display text-xl font-bold uppercase tracking-wide text-fg">Remover veículo</h2>
      <p className="mt-1 text-sm text-fg-muted">Seus agendamentos anteriores continuam no histórico com os dados deste veículo.</p>
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-status-danger">
          {error}
        </p>
      )}
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="btn-secondary mt-4 w-full sm:w-auto">
          Remover este veículo
        </button>
      ) : (
        <div className="mt-4 space-y-3" role="group" aria-label="Confirmar remoção">
          <p className="text-sm font-semibold text-fg">Tem certeza? Esta ação não pode ser desfeita.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={remove} disabled={pending} className="btn-danger w-full sm:w-auto">
              {pending ? "Removendo..." : "Sim, remover"}
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
