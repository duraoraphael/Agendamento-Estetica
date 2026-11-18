"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { saveVehicleStepAction, type VehicleStepState } from "@/app/agendar/veiculo/actions";
import { Notice } from "@/components/ui";
import { VehicleFields } from "@/components/VehicleFields";
import { CarIcon, PlusIcon } from "@/components/icons";
import { formatPlate } from "@/lib/plate";
import { horarioUrl } from "@/lib/booking-urls";
import { LIMITS } from "@/lib/limits";

export interface VehicleOption {
  id: string;
  label: string;
  plate: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full text-base">
      {pending ? "Salvando..." : "Continuar"}
    </button>
  );
}

/** Etapa "Veículo": escolher um veículo cadastrado ou cadastrar um novo na hora, mais observações opcionais. */
export function VehicleStepForm({
  serviceId,
  startAtIso,
  vehicles,
  initialNotes,
  atLimit,
}: {
  serviceId: string;
  startAtIso: string;
  vehicles: VehicleOption[];
  initialNotes: string;
  /** Já tem o máximo de veículos: só pode escolher entre os existentes. */
  atLimit: boolean;
}) {
  const [state, formAction] = useFormState<VehicleStepState, FormData>(saveVehicleStepAction, null);
  const [choice, setChoice] = useState<string>(vehicles[0]?.id ?? "new");
  const [notes, setNotes] = useState(initialNotes);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="mt-6 space-y-6">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="startAtIso" value={startAtIso} />

      {state?.error && <Notice tone="error">{state.error}</Notice>}

      <fieldset>
        <legend className="label">Veículo do atendimento</legend>
        <div className="space-y-2">
          {vehicles.map((v) => (
            <label
              key={v.id}
              className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition focus-within:ring-2 focus-within:ring-brand ${
                choice === v.id ? "border-brand bg-brand/10" : "border-line-strong bg-surface hover:border-brand/60"
              }`}
            >
              <input type="radio" name="vehicleChoice" value={v.id} checked={choice === v.id} onChange={() => setChoice(v.id)} className="h-5 w-5 flex-none accent-brand" />
              <CarIcon className="h-6 w-6 text-brand" />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-fg">{v.label}</span>
                <span className="block text-sm text-fg-muted">{formatPlate(v.plate)}</span>
              </span>
            </label>
          ))}
          {!atLimit && (
            <label
              className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition focus-within:ring-2 focus-within:ring-brand ${
                choice === "new" ? "border-brand bg-brand/10" : "border-line-strong bg-surface hover:border-brand/60"
              }`}
            >
              <input type="radio" name="vehicleChoice" value="new" checked={choice === "new"} onChange={() => setChoice("new")} className="h-5 w-5 flex-none accent-brand" />
              <PlusIcon className="h-6 w-6 text-brand" />
              <span className="font-semibold text-fg">Cadastrar um novo veículo</span>
            </label>
          )}
        </div>
        {errors.vehicleChoice && (
          <p className="error-text" role="alert">
            <span aria-hidden="true">⚠</span>
            {errors.vehicleChoice}
          </p>
        )}
      </fieldset>

      {choice === "new" && (
        <div className="rounded-2xl border border-brand/45 bg-surface p-4 sm:p-5">
          <VehicleFields prefix="novo_" errors={errors} />
        </div>
      )}

      <div>
        <label className="label" htmlFor="notes">
          Observações (opcional)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={LIMITS.notesMax}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ex.: Atenção especial nas rodas."
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={errors.notes ? "notes-erro" : "notes-dica"}
          className="input min-h-[110px] resize-y"
        />
        {errors.notes ? (
          <p id="notes-erro" className="error-text" role="alert">
            <span aria-hidden="true">⚠</span>
            {errors.notes}
          </p>
        ) : (
          <p id="notes-dica" className="hint-text">
            {notes.length}/{LIMITS.notesMax} caracteres. Não coloque senhas nem dados de pagamento.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <SubmitButton />
        <Link href={horarioUrl(serviceId)} className="btn-ghost w-full">
          Voltar e escolher outro horário
        </Link>
      </div>
    </form>
  );
}
