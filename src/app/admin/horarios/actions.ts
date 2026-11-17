"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { businessHoursSchema, blockedPeriodSchema, idSchema, isValidTime, formatZodError } from "@/lib/validation";
import { zonedToUtc } from "@/lib/format";
import { isValidDateKey } from "@/lib/date-keys";
import { recordAuditTx } from "@/lib/audit-log";

export type HorariosFormState = { errors: Record<string, string> } | { ok: true } | null;

export async function saveBusinessHoursAction(_prev: HorariosFormState, formData: FormData): Promise<HorariosFormState> {
  const admin = await requireAdmin();

  const errors: Record<string, string> = {};
  const valid: { day: number; data: NonNullable<ReturnType<typeof businessHoursSchema.safeParse>["data"]> }[] = [];

  // Valida os 7 dias ANTES de gravar qualquer um: com erro em algum dia, nada é salvo pela metade.
  for (let day = 0; day <= 6; day++) {
    const parsed = businessHoursSchema.safeParse({
      dayOfWeek: day,
      active: formData.get(`active-${day}`) === "on",
      startTime: formData.get(`startTime-${day}`),
      endTime: formData.get(`endTime-${day}`),
      breakStart: formData.get(`breakStart-${day}`) || "",
      breakEnd: formData.get(`breakEnd-${day}`) || "",
    });

    if (!parsed.success) {
      // Erro por dia (com a mensagem real), que o formulário exibe sob o dia correspondente.
      errors[`day-${day}`] = parsed.error.issues[0]?.message ?? "Verifique os horários.";
      continue;
    }

    valid.push({ day, data: parsed.data });
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  // Os 7 dias e o registro de auditoria entram juntos: tudo ou nada.
  await prisma.$transaction(async (tx) => {
    for (const { day, data } of valid) {
      await tx.businessHours.upsert({
        where: { dayOfWeek: day },
        update: {
          active: data.active,
          startTime: data.startTime,
          endTime: data.endTime,
          breakStart: data.breakStart || null,
          breakEnd: data.breakEnd || null,
        },
        create: {
          dayOfWeek: day,
          active: data.active,
          startTime: data.startTime,
          endTime: data.endTime,
          breakStart: data.breakStart || null,
          breakEnd: data.breakEnd || null,
        },
      });
    }
    const activeDays = valid.filter(({ data }) => data.active).length;
    await recordAuditTx(tx, { action: "business_hours_saved", actorId: admin.id, targetType: "BusinessHours", detail: `${activeDays} dia(s) com atendimento` });
  });

  revalidatePath("/admin/horarios");
  return { ok: true };
}

export async function addBlockedPeriodAction(_prev: HorariosFormState, formData: FormData): Promise<HorariosFormState> {
  const admin = await requireAdmin();

  const dateStr = formData.get("date")?.toString() ?? "";
  const startTime = formData.get("startTime")?.toString() ?? "";
  const endTime = formData.get("endTime")?.toString() ?? "";
  const reason = formData.get("reason")?.toString();

  const [y, m, d] = dateStr.split("-").map(Number);
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);

  if (!isValidDateKey(dateStr) || !isValidTime(startTime) || !isValidTime(endTime)) {
    return { errors: { _form: "Informe data e horários válidos para o bloqueio." } };
  }
  if (!y || !m || !d || Number.isNaN(sh) || Number.isNaN(eh)) {
    return { errors: { _form: "Informe data e horários válidos para o bloqueio." } };
  }

  const startAt = zonedToUtc(y, m, d, sh, sm || 0);
  const endAt = zonedToUtc(y, m, d, eh, em || 0);

  const parsed = blockedPeriodSchema.safeParse({
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    reason,
  });

  if (!parsed.success) {
    return { errors: formatZodError(parsed.error) };
  }

  // O motivo (texto livre) NÃO vai para o log; só a data e a faixa de horas.
  await prisma.$transaction(async (tx) => {
    const created = await tx.blockedPeriod.create({
      data: { startAt, endAt, reason: parsed.data.reason || null },
    });
    await recordAuditTx(tx, {
      action: "blocked_period_created",
      actorId: admin.id,
      targetType: "BlockedPeriod",
      targetId: created.id,
      detail: `${dateStr} das ${startTime} às ${endTime}`,
    });
  });

  revalidatePath("/admin/horarios");
  return { ok: true };
}

export async function deleteBlockedPeriodAction(id: string) {
  const admin = await requireAdmin();
  if (!idSchema.safeParse(id).success) return;
  await prisma.$transaction(async (tx) => {
    const removed = await tx.blockedPeriod.deleteMany({ where: { id } });
    if (removed.count > 0) {
      await recordAuditTx(tx, { action: "blocked_period_deleted", actorId: admin.id, targetType: "BlockedPeriod", targetId: id });
    }
  });
  revalidatePath("/admin/horarios");
}
