import { prisma } from "./db";
import type { Appointment } from "@prisma/client";

/**
 * Busca uma reserva garantindo que pertence à cliente informada. Retorna
 * null tanto se a reserva não existe quanto se pertence a outra pessoa —
 * de propósito, para nunca revelar a existência de reservas de terceiros
 * mesmo que alguém altere o id na URL diretamente.
 */
export async function getAppointmentForClient(appointmentId: string, clientId: string) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment || appointment.clientId !== clientId) return null;
  return appointment;
}

/** Separa as reservas de uma cliente em "próximos horários" e "histórico". */
export function splitUpcomingAndHistory(appointments: Appointment[], now: Date = new Date()) {
  const upcoming = appointments
    .filter((a) => a.status === "CONFIRMADA" && a.startAt > now)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const history = appointments
    .filter((a) => !(a.status === "CONFIRMADA" && a.startAt > now))
    .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());

  return { upcoming, history };
}
