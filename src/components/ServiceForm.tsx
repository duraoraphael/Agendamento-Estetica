"use client";

import { useFormState } from "react-dom";
import { upsertServiceAction, type ServiceFormState } from "@/app/admin/servicos/actions";

interface ServiceFormProps {
  service?: {
    id: string;
    name: string;
    priceCents: number;
    durationMinutes: number;
    active: boolean;
  };
}

export function ServiceForm({ service }: ServiceFormProps) {
  const [state, formAction] = useFormState<ServiceFormState, FormData>(upsertServiceAction, null);
  const errors = state?.errors ?? {};
  const defaultPrice = service ? (service.priceCents / 100).toFixed(2).replace(".", ",") : "";

  return (
    <form action={formAction} className="card space-y-4">
      {service && <input type="hidden" name="id" value={service.id} />}

      {errors._form && <div className="notice-error" role="alert">{errors._form}</div>}

      <div>
        <label className="label" htmlFor="name">
          Nome do serviço
        </label>
        <input id="name" name="name" required className="input" defaultValue={service?.name} placeholder="Ex: Manicure tradicional" />
        {errors.name && <p className="error-text">{errors.name}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="priceReais">
            Preço (R$)
          </label>
          <input
            id="priceReais"
            name="priceReais"
            required
            inputMode="decimal"
            className="input"
            defaultValue={defaultPrice}
            placeholder="40,00"
          />
          {errors.priceReais && <p className="error-text">{errors.priceReais}</p>}
        </div>
        <div>
          <label className="label" htmlFor="durationMinutes">
            Duração (min)
          </label>
          <input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={5}
            step={5}
            required
            className="input"
            defaultValue={service?.durationMinutes ?? 30}
          />
          {errors.durationMinutes && <p className="error-text">{errors.durationMinutes}</p>}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-plum-muted">
        <input type="checkbox" name="active" defaultChecked={service?.active ?? true} className="h-5 w-5 rounded border-plum-line text-wine focus:ring-wine" />
        Serviço ativo (visível para as clientes)
      </label>

      <div className="flex gap-3">
        <button type="submit" className="btn-primary flex-1">
          Salvar serviço
        </button>
      </div>
    </form>
  );
}
