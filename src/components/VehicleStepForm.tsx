"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { saveVehicleStepAction, type VehicleStepState } from "@/app/agendar/veiculo/actions";
import { Notice } from "@/components/ui";
import { VehicleFields } from "@/components/VehicleFields";
import { CarIcon, PlusIcon } from "@/components/icons";
import { formatPlate } from "@/lib/plate";
import { formatCents } from "@/lib/format";
import { LIMITS } from "@/lib/limits";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS, isVehicleType, type VehicleType } from "@/lib/pricing";

export interface VehicleOption {
  id: string;
  label: string;
  plate: string;
  /** Tipo gravado (nulo = veículo antigo). */
  vehicleType: string | null;
  /** Valor para este veículo; nulo quando falta o tipo e a cobrança por tipo está ligada. */
  priceCents: number | null;
}

/** Como o valor é decidido: `byType` já traz o preço efetivo de cada categoria (padrão onde não há preço específico). */
export interface StepPricing {
  enabled: boolean;
  defaultCents: number;
  byType: Record<VehicleType, number>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full text-base">
      {pending ? "Salvando..." : "Continuar"}
    </button>
  );
}

const optionClass = (selected: boolean) =>
  `flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition focus-within:ring-2 focus-within:ring-brand ${
    selected ? "border-brand bg-brand/10" : "border-line-strong bg-surface hover:border-brand/60"
  }`;

/**
 * Etapa "Veículo" (antes do horário): escolher um veículo cadastrado ou cadastrar um novo na hora, mais observações
 * opcionais. Mostra o valor para o veículo escolhido (o servidor recalcula tudo de novo na reserva).
 */
export function VehicleStepForm({
  serviceId,
  data,
  hora,
  vehicles,
  pricing,
  initialNotes,
  atLimit,
}: {
  serviceId: string;
  /** Preferências de dia e horário vindas do agendamento rápido (opcionais; o servidor valida de novo). */
  data?: string;
  hora?: string;
  vehicles: VehicleOption[];
  pricing: StepPricing;
  initialNotes: string;
  /** Já tem o máximo de veículos: só pode escolher entre os existentes. */
  atLimit: boolean;
}) {
  const [state, formAction] = useFormState<VehicleStepState, FormData>(saveVehicleStepAction, null);
  const [choice, setChoice] = useState<string>(vehicles[0]?.id ?? "new");
  const [notes, setNotes] = useState(initialNotes);
  // Tipo escolhido para um veículo antigo (completar) e para o veículo novo (formulário de cadastro).
  const [completeType, setCompleteType] = useState("");
  const [newType, setNewType] = useState("");
  const errors = state?.fieldErrors ?? {};

  // Trocar de opção desmonta o select de tipo (volta para "Selecione…"): o tipo guardado aqui tem que voltar junto, senão a
  // caixa de valor continuaria mostrando o preço de uma escolha anterior.
  const chooseExisting = (id: string) => {
    setChoice(id);
    setNewType("");
    setCompleteType("");
  };

  const selected = vehicles.find((v) => v.id === choice);
  const typePrice = (type: string) => (isVehicleType(type) ? pricing.byType[type] : null);

  let price: number | null;
  if (choice === "new") price = pricing.enabled ? typePrice(newType) : pricing.defaultCents;
  else if (selected && selected.priceCents !== null) price = selected.priceCents;
  else price = typePrice(completeType);

  // Valor de cada opção da lista (veículo antigo sem tipo, com a cobrança ligada, só tem valor depois de escolher o tipo).
  const optionPrice = (v: VehicleOption) => (v.id === choice && v.priceCents === null ? price : v.priceCents);

  return (
    <form action={formAction} className="mt-6 space-y-6">
      <input type="hidden" name="serviceId" value={serviceId} />
      {data && <input type="hidden" name="data" value={data} />}
      {hora && <input type="hidden" name="hora" value={hora} />}

      {state?.error && <Notice tone="error">{state.error}</Notice>}

      {vehicles.length === 0 && <Notice tone="warning">Cadastre seu veículo para ver o valor e escolher o horário.</Notice>}

      <fieldset>
        <legend className="label">Veículo do atendimento</legend>
        <div className="space-y-2">
          {vehicles.map((v) => {
            const shown = optionPrice(v);
            return (
              <div key={v.id}>
                <label className={optionClass(choice === v.id)}>
                  <input type="radio" name="vehicleChoice" value={v.id} checked={choice === v.id} onChange={() => chooseExisting(v.id)} className="h-5 w-5 flex-none accent-brand" />
                  <CarIcon className="h-6 w-6 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-fg">{v.label}</span>
                    <span className="block text-sm text-fg-muted">
                      {isVehicleType(v.vehicleType) ? `${VEHICLE_TYPE_LABELS[v.vehicleType]} · ` : ""}
                      {formatPlate(v.plate)}
                    </span>
                  </span>
                  <span className="flex-none font-display text-lg font-bold text-brand">{shown !== null ? formatCents(shown) : "—"}</span>
                </label>
                {choice === v.id && v.priceCents === null && (
                  <div className="mt-2 rounded-xl border border-brand/45 bg-surface p-4">
                    <label className="label" htmlFor="completeType">
                      Complete o tipo deste veículo
                    </label>
                    <select
                      id="completeType"
                      name="completeType"
                      required
                      value={completeType}
                      onChange={(e) => setCompleteType(e.target.value)}
                      aria-invalid={errors.completeType ? true : undefined}
                      aria-describedby={errors.completeType ? "completeType-erro" : "completeType-dica"}
                      className="input"
                    >
                      <option value="">Selecione…</option>
                      {VEHICLE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {VEHICLE_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    {errors.completeType ? (
                      <p id="completeType-erro" className="error-text" role="alert">
                        <span aria-hidden="true">⚠</span>
                        {errors.completeType}
                      </p>
                    ) : (
                      <p id="completeType-dica" className="hint-text">
                        O preço deste serviço depende do tipo do veículo. Você pode mudar depois em Minha conta.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!atLimit && (
            <label className={optionClass(choice === "new")}>
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
          <VehicleFields prefix="novo_" errors={errors} onVehicleTypeChange={setNewType} />
        </div>
      )}

      <section aria-label="Valor do serviço" aria-live="polite" className="rounded-2xl border border-brand/50 bg-surface px-5 py-4">
        <p className="text-sm text-fg-muted">Valor para o veículo escolhido</p>
        <p className="font-display text-3xl font-extrabold text-brand">{price !== null ? formatCents(price) : "—"}</p>
        {price === null && <p className="hint-text">Informe o tipo do veículo para ver o valor.</p>}
      </section>

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
        <Link href="/agendar" className="btn-ghost w-full">
          Voltar e escolher outro serviço
        </Link>
      </div>
    </form>
  );
}
