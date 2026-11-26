"use client";

import { useFormState, useFormStatus } from "react-dom";
import { togglePriceByTypeAction, type PriceModeState } from "@/app/admin/configuracoes/preco-actions";
import { Notice } from "@/components/ui";

function ToggleButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${enabled ? "btn-secondary" : "btn-primary"} w-full sm:w-auto`}>
      {pending ? "Salvando..." : enabled ? "Desligar cobrança por tipo de veículo" : "Ligar cobrança por tipo de veículo"}
    </button>
  );
}

/**
 * "Cobrar por tipo de veículo". Um clique liga ou desliga e já grava (sem caixa para marcar e botão "Salvar" separado,
 * que era fácil de esquecer). `enabled` vem do banco; o servidor confere o papel de administradora e grava.
 */
export function PriceModeForm({ enabled }: { enabled: boolean }) {
  const [state, formAction] = useFormState<PriceModeState, FormData>(togglePriceByTypeAction, null);

  return (
    <form action={formAction} className="card space-y-4" aria-labelledby="preco-tipo-titulo">
      <div>
        <h2 id="preco-tipo-titulo" className="font-display text-xl font-bold uppercase tracking-wide text-fg">
          Cobrar por tipo de veículo
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Desligado: todos os veículos pagam o preço padrão do serviço. Ligado: vale o preço de cada serviço por categoria (Hatch, Sedã, SUV, Picape e
          Van/Utilitário), definido em Serviços → Editar; categoria sem preço usa o preço padrão.
        </p>
      </div>

      {state && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}

      <p className="text-fg">
        Situação atual: <strong>{enabled ? "ligada" : "desligada"}</strong>
        {enabled ? " — o preço segue o tipo do veículo." : " — todos pagam o preço padrão."}
      </p>

      {/* O formulário leva o estado DESEJADO: marcado para ligar; ausente para desligar. */}
      {!enabled && <input type="hidden" name="priceByVehicleType" value="on" />}
      <ToggleButton enabled={enabled} />
    </form>
  );
}
