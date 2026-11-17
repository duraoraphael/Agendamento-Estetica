-- Garantias de integridade no PRÓPRIO banco (valem para qualquer processo/instância, mesmo que
-- alguém grave por fora da aplicação).

-- 1) Nenhuma sobreposição de horários entre reservas que ocupam a agenda (CONFIRMADA/CONCLUIDA).
--    Intervalo semiaberto [início, fim): reservas CONSECUTIVAS (uma termina às 10:00, outra começa
--    às 10:00) são permitidas. Há uma única profissional/agenda, então o recurso é um só e não
--    precisamos da extensão btree_gist (que exigiria privilégio de superusuário em alguns provedores).
--    A coluna é "timestamp" (UTC), por isso tsrange é imutável e pode ser indexada.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_no_overlap"
  EXCLUDE USING gist (tsrange("startAt", "endAt", '[)') WITH &&)
  WHERE ("status" IN ('CONFIRMADA', 'CONCLUIDA'));

-- 2) Intervalo e valores válidos.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_valid_range" CHECK ("endAt" > "startAt");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_valid_status"
  CHECK ("status" IN ('CONFIRMADA', 'CONCLUIDA', 'CANCELADA', 'FALTA'));
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_valid_price_duration"
  CHECK ("priceCents" >= 0 AND "durationMinutes" > 0);
ALTER TABLE "User" ADD CONSTRAINT "User_valid_role" CHECK ("role" IN ('CLIENTE', 'ADMIN'));
ALTER TABLE "BlockedPeriod" ADD CONSTRAINT "BlockedPeriod_valid_range" CHECK ("endAt" > "startAt");

-- 3) Linha única usada como ponto de serialização das transações de reserva (veja src/lib/booking.ts).
INSERT INTO "BookingLock" ("id", "version") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING;
