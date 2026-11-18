/**
 * Limites de tamanho e de quantidade usados na validação (servidor) e nos campos da tela (maxLength). Fica num módulo
 * sem dependências para que as telas possam usá-los sem levar o Zod para o navegador.
 */
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
  vehicleBrandMax: 40,
  vehicleModelMax: 60,
  vehicleColorMax: 30,
  vehicleNicknameMax: 40,
  notesMax: 500,
  // Teto de veículos por conta (barra cadastro em massa; conferido no servidor, dentro da transação).
  vehiclesPerUserMax: 10,
  // Token de recuperação de senha em base64url de 32 bytes = 43 caracteres; folga para variações, mas com teto.
  resetTokenMax: 128,
} as const;
