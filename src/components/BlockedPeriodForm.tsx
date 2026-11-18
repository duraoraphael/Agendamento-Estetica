"use client";

import { useFormState } from "react-dom";
import { addBlockedPeriodAction, type HorariosFormState } from "@/app/admin/horarios/actions";

export function BlockedPeriodForm() {
  const [state, formAction] = useFormState<HorariosFormState, FormData>(addBlockedPeriodAction, null);
  const errors = state && "errors" in state ? state.errors : {};

  return (
    <form action={formAction} className="card space-y-3">
      <h2 className="font-semibold text-fg">Novo bloqueio (feriado, folga, férias...)</h2>
      {errors._form && <div className="notice-error" role="alert">{errors._form}</div>}

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label" htmlFor="block-date">
            Data
          </label>
          <input id="block-date" type="date" name="date" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="block-start">
            Das
          </label>
          <input id="block-start" type="time" name="startTime" required defaultValue="00:00" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="block-end">
            Até
          </label>
          <input id="block-end" type="time" name="endTime" required defaultValue="23:59" className="input" />
        </div>
      </div>
      {errors.endAt && <p className="error-text">{errors.endAt}</p>}

      <div>
        <label className="label" htmlFor="block-reason">
          Motivo (opcional)
        </label>
        <input id="block-reason" type="text" name="reason" className="input" placeholder="Ex: Feriado, folga, férias" />
      </div>

      <button type="submit" className="btn-secondary w-full">
        Adicionar bloqueio
      </button>
    </form>
  );
}
