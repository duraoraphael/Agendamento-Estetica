"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { confirmBookingAction, type ConfirmState } from "@/app/agendar/actions";
import { Notice } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full text-base">
      {pending ? "Confirmando..." : "Confirmar agendamento"}
    </button>
  );
}

export function ConfirmBookingForm({ serviceId, startAtIso }: { serviceId: string; startAtIso: string }) {
  const [state, formAction] = useFormState<ConfirmState, FormData>(confirmBookingAction, null);

  return (
    <form action={formAction} className="mt-6 space-y-3">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="startAtIso" value={startAtIso} />

      {state?.error && (
        <Notice tone="error">
          {state.error}{" "}
          <Link href={`/agendar/horario?serviceId=${serviceId}&conflito=1`} className="font-semibold underline underline-offset-4">
            Escolher outro horário
          </Link>
        </Notice>
      )}

      <SubmitButton />
      <Link href={`/agendar/horario?serviceId=${serviceId}`} className="btn-ghost w-full">
        Voltar e escolher outro horário
      </Link>
    </form>
  );
}
