"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireClient } from "@/lib/session";
import { idSchema } from "@/lib/validation";
import { RATE_LIMITS } from "@/lib/constants";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { createVehicle, deleteVehicle, parseVehicleForm, updateVehicle, vehicleFieldErrors, VehicleError } from "@/lib/vehicles";

export type VehicleFormState = { error?: string; fieldErrors?: Record<string, string> } | null;

const BLOCKED = "Muitos pedidos seguidos. Aguarde um instante e tente novamente.";

async function guardWrite(userId: string) {
  const write = await hitLimit(limitKey("account-write-user", userId), RATE_LIMITS.accountWritesPerMinute, 60_000);
  return !write.blocked;
}

/**
 * Cadastra um veículo para a PRÓPRIA conta. A dona é sempre a da sessão: `userId`, `id` ou qualquer campo extra do
 * formulário são ignorados (só brand, model, plate, year, color e nickname são lidos e validados).
 */
export async function createVehicleAction(_prev: VehicleFormState, formData: FormData): Promise<VehicleFormState> {
  const user = await requireClient();
  const parsed = parseVehicleForm(formData);
  if (!parsed.success) return { fieldErrors: vehicleFieldErrors(parsed.error) };
  if (!(await guardWrite(user.id))) return { error: BLOCKED };

  try {
    await createVehicle(user.id, parsed.data);
  } catch (err) {
    if (err instanceof VehicleError) return err.message.includes("placa") ? { fieldErrors: { plate: err.message } } : { error: err.message };
    console.error("Erro ao cadastrar veículo:", err instanceof Error ? err.message : err);
    return { error: "Não foi possível salvar o veículo. Tente novamente." };
  }
  revalidatePath("/minha-conta");
  redirect("/minha-conta/veiculos?salvo=1");
}

/** Edita um veículo da própria conta (o ID do formulário só vale se o veículo for da sessão; senão, "não encontrado"). */
export async function updateVehicleAction(_prev: VehicleFormState, formData: FormData): Promise<VehicleFormState> {
  const user = await requireClient();
  const vehicleId = formData.get("vehicleId")?.toString() ?? "";
  if (!idSchema.safeParse(vehicleId).success) return { error: "Veículo não encontrado." };
  const parsed = parseVehicleForm(formData);
  if (!parsed.success) return { fieldErrors: vehicleFieldErrors(parsed.error) };
  if (!(await guardWrite(user.id))) return { error: BLOCKED };

  try {
    await updateVehicle(user.id, vehicleId, parsed.data);
  } catch (err) {
    if (err instanceof VehicleError) return err.message.includes("placa") ? { fieldErrors: { plate: err.message } } : { error: err.message };
    console.error("Erro ao editar veículo:", err instanceof Error ? err.message : err);
    return { error: "Não foi possível salvar o veículo. Tente novamente." };
  }
  revalidatePath("/minha-conta");
  revalidatePath("/minha-conta/veiculos");
  redirect("/minha-conta/veiculos?salvo=1");
}

export async function deleteVehicleAction(vehicleId: string): Promise<{ error?: string } | undefined> {
  const user = await requireClient();
  if (!idSchema.safeParse(vehicleId).success) return { error: "Veículo não encontrado." };
  if (!(await guardWrite(user.id))) return { error: BLOCKED };

  try {
    await deleteVehicle(user.id, vehicleId);
  } catch (err) {
    if (err instanceof VehicleError) return { error: err.message };
    console.error("Erro ao remover veículo:", err instanceof Error ? err.message : err);
    return { error: "Não foi possível remover o veículo. Tente novamente." };
  }
  revalidatePath("/minha-conta");
  revalidatePath("/minha-conta/veiculos");
  redirect("/minha-conta/veiculos?removido=1");
}
