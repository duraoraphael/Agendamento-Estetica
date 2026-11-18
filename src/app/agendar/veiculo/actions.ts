"use server";

import { redirect } from "next/navigation";
import { requireClient } from "@/lib/session";
import { idSchema, notesSchema } from "@/lib/validation";
import { RATE_LIMITS } from "@/lib/constants";
import { hitLimit, limitKey } from "@/lib/rate-limit";
import { createVehicle, getVehicleForUser, parseVehicleForm, vehicleFieldErrors, VehicleError } from "@/lib/vehicles";
import { setNotesDraft } from "@/lib/booking-draft";
import { prisma } from "@/lib/db";
import { revisarUrl } from "@/lib/booking-urls";

export type VehicleStepState = { error?: string; fieldErrors?: Record<string, string> } | null;

const NEW_PREFIX = "novo_";

/**
 * Etapa 3 do agendamento: escolher um veículo da conta OU cadastrar um novo, e informar observações. Tudo é validado
 * aqui (o formulário é só uma conveniência): o ID do veículo vem do formulário e só vale se for da própria cliente.
 */
export async function saveVehicleStepAction(_prev: VehicleStepState, formData: FormData): Promise<VehicleStepState> {
  const user = await requireClient();

  const serviceId = formData.get("serviceId")?.toString() ?? "";
  const startAtIso = formData.get("startAtIso")?.toString() ?? "";
  if (!idSchema.safeParse(serviceId).success || startAtIso.length > 40 || Number.isNaN(new Date(startAtIso).getTime())) {
    return { error: "Dados do agendamento incompletos. Volte e escolha o serviço e o horário novamente." };
  }
  const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { active: true } });
  if (!service?.active) return { error: "Esse serviço não está mais disponível. Volte e escolha outro serviço." };

  const notes = notesSchema.safeParse(formData.get("notes")?.toString() ?? "");
  if (!notes.success) return { fieldErrors: { notes: notes.error.issues[0]?.message ?? "Observações inválidas." } };

  const write = await hitLimit(limitKey("account-write-user", user.id), RATE_LIMITS.accountWritesPerMinute, 60_000);
  if (write.blocked) return { error: "Muitos pedidos seguidos. Aguarde um instante e tente novamente." };

  const choice = formData.get("vehicleChoice")?.toString() ?? "";
  let vehicleId: string;
  if (choice === "new") {
    const parsed = parseVehicleForm(formData, NEW_PREFIX);
    if (!parsed.success) return { fieldErrors: vehicleFieldErrors(parsed.error, NEW_PREFIX) };
    try {
      vehicleId = (await createVehicle(user.id, parsed.data)).id;
    } catch (err) {
      if (err instanceof VehicleError) return { fieldErrors: { [`${NEW_PREFIX}plate`]: err.message } };
      console.error("Erro ao cadastrar veículo:", err);
      return { error: "Não foi possível salvar o veículo. Tente novamente." };
    }
  } else {
    if (!idSchema.safeParse(choice).success || !(await getVehicleForUser(user.id, choice))) {
      return { fieldErrors: { vehicleChoice: "Escolha um veículo da lista ou cadastre um novo." } };
    }
    vehicleId = choice;
  }

  await setNotesDraft(notes.data);
  redirect(revisarUrl(serviceId, new Date(startAtIso).toISOString(), vehicleId));
}
