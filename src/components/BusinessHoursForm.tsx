"use client";

import { useFormState } from "react-dom";
import { saveBusinessHoursAction, type HorariosFormState } from "@/app/admin/horarios/actions";
import { WEEKDAY_LABELS } from "@/lib/constants";

interface DayHours {
  dayOfWeek: number;
  active: boolean;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
}

export function BusinessHoursForm({ hoursByDay }: { hoursByDay: Record<number, DayHours> }) {
  const [state, formAction] = useFormState<HorariosFormState, FormData>(saveBusinessHoursAction, null);
  const errors = state && "errors" in state ? state.errors : {};

  return (
    <form action={formAction} className="card space-y-4">
      {state && "ok" in state && (
        <div className="notice-success" role="status">Expediente salvo com sucesso.</div>
      )}
      {errors._form && <div className="notice-error" role="alert">{errors._form}</div>}

      <div className="space-y-3">
        {WEEKDAY_LABELS.map((label, day) => {
          const d = hoursByDay[day];
          return (
            <div key={day} className="rounded-xl border border-line p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-fg">
                <input type="checkbox" name={`active-${day}`} defaultChecked={d?.active ?? false} className="h-5 w-5 rounded border-line-strong text-brand focus:ring-brand" />
                {label}
              </label>

              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label className="label" htmlFor={`startTime-${day}`}>
                    Início
                  </label>
                  <input id={`startTime-${day}`} type="time" name={`startTime-${day}`} defaultValue={d?.startTime ?? "09:00"} className="input" />
                </div>
                <div>
                  <label className="label" htmlFor={`endTime-${day}`}>
                    Fim
                  </label>
                  <input id={`endTime-${day}`} type="time" name={`endTime-${day}`} defaultValue={d?.endTime ?? "18:00"} className="input" />
                </div>
                <div>
                  <label className="label" htmlFor={`breakStart-${day}`}>
                    Almoço início
                  </label>
                  <input id={`breakStart-${day}`} type="time" name={`breakStart-${day}`} defaultValue={d?.breakStart ?? ""} className="input" />
                </div>
                <div>
                  <label className="label" htmlFor={`breakEnd-${day}`}>
                    Almoço fim
                  </label>
                  <input id={`breakEnd-${day}`} type="time" name={`breakEnd-${day}`} defaultValue={d?.breakEnd ?? ""} className="input" />
                </div>
              </div>
              {errors[`day-${day}`] ? (
                <p className="error-text" role="alert">
                  {label}: {errors[`day-${day}`]}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <button type="submit" className="btn-primary w-full">
        Salvar expediente
      </button>
    </form>
  );
}
