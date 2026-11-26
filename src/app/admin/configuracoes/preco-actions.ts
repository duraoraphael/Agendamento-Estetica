"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { RATE_LIMITS } from "@/lib/constants";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";
import { setPriceByTypeEnabled } from "@/lib/pricing-data";

export type PriceModeState = { ok: boolean; message: string } | null;

/**
 * Liga/desliga "Cobrar por tipo de veículo". Só a administradora: `requireAdmin` confere a sessão E o papel no banco a
 * cada chamada (uma Server Action é um endpoint público; esconder o botão não protege nada). Desligar NÃO apaga os
 * preços por categoria: ficam guardados e voltam a valer se a chave for ligada de novo.
 */
export async function togglePriceByTypeAction(_prev: PriceModeState, formData: FormData): Promise<PriceModeState> {
  const admin = await requireAdmin();

  const limit = await hitLimit(limitKey("settings-admin", admin.id), RATE_LIMITS.settingsPerMinute, 60_000);
  if (limit.blocked) {
    securityLog("settings_rate_limited", { userId: admin.id });
    return { ok: false, message: "Muitas alterações seguidas. Aguarde um instante e tente de novo." };
  }

  const enabled = formData.get("priceByVehicleType") === "on";
  try {
    await setPriceByTypeEnabled(enabled, admin.id);
  } catch (err) {
    console.error("Erro ao salvar a cobrança por tipo de veículo:", err instanceof Error ? err.message : err);
    return { ok: false, message: "Não foi possível salvar agora. Tente novamente em instantes." };
  }

  // O preço lido pelas telas e pela reserva nunca passa por cache; revalida as páginas que mostram preços.
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: enabled
      ? "Cobrança por tipo de veículo ligada. Defina o preço de cada serviço por categoria na edição do serviço."
      : "Cobrança por tipo de veículo desligada. Todos pagam o preço padrão; os preços por categoria continuam guardados.",
  };
}
