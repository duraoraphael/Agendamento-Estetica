import { z } from "zod";

// Celular brasileiro com DDD: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX, com ou sem máscara.
const phoneRegex = /^\(?\d{2}\)?[\s-]?\d{4,5}-?\d{4}$/;

export const LIMITS = {
  nameMax: 100,
  emailMax: 254,
  phoneMax: 20,
  passwordMin: 8,
  // O bcrypt só usa os primeiros 72 BYTES da senha. Acima disso o resto seria
  // ignorado em silêncio, então rejeitamos em vez de truncar.
  passwordMaxBytes: 72,
  // No login aceitamos mais (contas antigas podem ter senhas longas); o bcrypt
  // continua comparando apenas os 72 primeiros bytes, como na criação da conta.
  loginPasswordMaxBytes: 1024,
  serviceNameMax: 80,
  priceCentsMax: 500_000, // R$ 5.000,00
  durationMax: 480, // 8 horas
  reasonMax: 200,
  idMax: 64,
} as const;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// Senhas muito comuns (comparadas em minúsculas). Lista curta de propósito:
// barra as piores escolhas sem exigir regras de composição irritantes.
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "11111111", "00000000", "87654321",
  "password", "password1", "password123", "senha123", "senha1234", "senha@123",
  "qwertyui", "qwerty123", "qwertyuiop", "abc12345", "abcd1234", "iloveyou",
  "admin123", "admin1234", "mudar123", "trocar123", "brasil123", "manicure",
  "12341234", "123123123", "1q2w3e4r", "q1w2e3r4",
]);

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `A senha deve ter pelo menos ${LIMITS.passwordMin} caracteres.`)
  .refine(
    (v) => utf8ByteLength(v) <= LIMITS.passwordMaxBytes,
    `A senha é longa demais (máximo de ${LIMITS.passwordMaxBytes} bytes; acentos e emojis ocupam mais de um).`
  )
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), "Essa senha é muito comum. Escolha uma senha mais difícil de adivinhar.")
  .refine((v) => new Set(v).size > 1, "Escolha uma senha com caracteres variados.");

export const signupSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Informe seu nome completo.")
      .max(LIMITS.nameMax, `O nome pode ter no máximo ${LIMITS.nameMax} caracteres.`)
      .refine((v) => v.trim().split(/\s+/).length >= 2, "Informe nome e sobrenome."),
    email: z.string().trim().toLowerCase().max(LIMITS.emailMax, "E-mail longo demais.").email("Informe um e-mail válido."),
    phone: z
      .string()
      .trim()
      .max(LIMITS.phoneMax, "Celular inválido.")
      .regex(phoneRegex, "Informe um celular válido com DDD, ex: (11) 90000-0000."),
    password: passwordSchema,
    confirmPassword: z.string().max(LIMITS.passwordMaxBytes * 4),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(LIMITS.emailMax).email("Informe um e-mail válido."),
  password: z
    .string()
    .min(1, "Informe sua senha.")
    .refine((v) => utf8ByteLength(v) <= LIMITS.loginPasswordMaxBytes, "Senha inválida."),
});

export const serviceSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do serviço.").max(LIMITS.serviceNameMax, `O nome pode ter no máximo ${LIMITS.serviceNameMax} caracteres.`),
  priceCents: z.coerce
    .number()
    .int()
    .min(0, "Informe um preço válido.")
    .max(LIMITS.priceCentsMax, "O preço máximo é R$ 5.000,00."),
  durationMinutes: z.coerce
    .number()
    .int()
    .min(5, "A duração mínima é 5 minutos.")
    .max(LIMITS.durationMax, "A duração máxima é 480 minutos (8 horas)."),
  active: z.coerce.boolean().default(true),
});

export type ServiceInput = z.infer<typeof serviceSchema>;

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:mm" de 00:00 a 23:59. */
export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && timeRegex.test(value);
}

export const businessHoursSchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    active: z.coerce.boolean().default(false),
    startTime: z.string().regex(timeRegex, "Horário inválido."),
    endTime: z.string().regex(timeRegex, "Horário inválido."),
    breakStart: z.string().regex(timeRegex).optional().or(z.literal("")),
    breakEnd: z.string().regex(timeRegex).optional().or(z.literal("")),
  })
  .refine((d) => d.startTime < d.endTime, {
    message: "O horário de início deve ser antes do horário de término.",
    path: ["endTime"],
  })
  .refine(
    (d) => {
      if (!d.breakStart && !d.breakEnd) return true;
      if (!d.breakStart || !d.breakEnd) return false;
      return d.breakStart < d.breakEnd;
    },
    { message: "Informe início e fim do intervalo de almoço corretamente.", path: ["breakEnd"] }
  )
  .refine(
    (d) => {
      if (!d.breakStart || !d.breakEnd) return true;
      // O almoço precisa caber dentro do expediente; senão ele "estende" o horário de atendimento.
      return d.breakStart >= d.startTime && d.breakEnd <= d.endTime;
    },
    { message: "O intervalo de almoço deve ficar dentro do expediente.", path: ["breakEnd"] }
  );

export const blockedPeriodSchema = z
  .object({
    startAt: z.string().min(1, "Informe a data/hora de início."),
    endAt: z.string().min(1, "Informe a data/hora de término."),
    reason: z.string().trim().max(LIMITS.reasonMax, `O motivo pode ter no máximo ${LIMITS.reasonMax} caracteres.`).optional(),
  })
  .refine((d) => new Date(d.startAt) < new Date(d.endAt), {
    message: "O início do bloqueio deve ser antes do término.",
    path: ["endAt"],
  });

export const idSchema = z.string().min(1).max(LIMITS.idMax);

export const createBookingSchema = z.object({
  serviceId: idSchema,
  startAtIso: z
    .string()
    .min(1, "Selecione um horário.")
    .max(40)
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Horário inválido. Escolha um horário na lista."),
});

export const statusUpdateSchema = z.object({
  status: z.enum(["CONFIRMADA", "CONCLUIDA", "CANCELADA", "FALTA"]),
});

export function formatZodError(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}
