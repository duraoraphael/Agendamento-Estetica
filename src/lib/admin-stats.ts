import { cache } from "react";
import { prisma } from "./db";

/**
 * Quantos agendamentos novos a administradora ainda não viu (selo do menu e aviso da tela "Hoje").
 * Deduplicado por requisição: o layout e a página perguntam, o banco responde uma vez.
 */
export const getNewAppointmentsCount = cache(async (adminId: string): Promise<number> => {
  const user = await prisma.user.findUnique({ where: { id: adminId }, select: { notificationsSeenAt: true } });
  if (!user) return 0;
  return prisma.appointment.count({ where: { createdAt: { gt: user.notificationsSeenAt } } });
});
