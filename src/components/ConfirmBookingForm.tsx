"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { confirmBookingAction, type ConfirmState } from "@/app/agendar/actions";
import { Notice } from "@/components/ui";
import { horarioUrl, revisarUrl, veiculoUrl } from "@/lib/booking-urls";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full text-base">
      {pending ? "Confirmando..." : "Confirmar agendamento"}
    </button>
  );
}

/**
 * Etapa 4: confirma. Veículo, observações e o valor mostrado viajam como campos ocultos e são validados de novo no
 * servidor: o valor aqui é só uma conferência (o servidor recalcula o preço e recusa se mudou), nunca o que é cobrado.
 */
export function ConfirmBookingForm({
  serviceId,
  startAtIso,
  vehicleId,
  notes,
  expectedPriceCents,
}: {
  serviceId: string;
  startAtIso: string;
  vehicleId: string;
  notes: string;
  expectedPriceCents: number;
}) {
  const [state, formAction] = useFormState<ConfirmState, FormData>(confirmBookingAction, null);

  return (
    <form action={formAction} className="mt-6 space-y-3">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="startAtIso" value={startAtIso} />
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <input type="hidden" name="notes" value={notes} />
      <input type="hidden" name="expectedPriceCents" value={expectedPriceCents} />

      {state?.error && (
        <Notice tone="error">
          {state.error}{" "}
          {state.priceChanged ? (
            <Link href={revisarUrl(serviceId, startAtIso, vehicleId)} className="font-semibold underline underline-offset-4">
              Rever o agendamento
            </Link>
          ) : (
            <Link href={horarioUrl(serviceId, { vehicleId, conflito: true })} className="font-semibold underline underline-offset-4">
              Escolher outro horário
            </Link>
          )}
        </Notice>
      )}

      <SubmitButton />
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href={veiculoUrl(serviceId)} className="btn-ghost w-full">
          Voltar e trocar o veículo
        </Link>
        <Link href={horarioUrl(serviceId, { vehicleId })} className="btn-ghost w-full">
          Voltar e escolher outro horário
        </Link>
      </div>
    </form>
  );
}
