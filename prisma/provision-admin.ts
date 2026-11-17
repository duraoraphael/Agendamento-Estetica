import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { passwordSchema } from "../src/lib/validation";

/** O e-mail reservado ao administrador já pertence a uma conta que não é ADMIN: o provisionamento é interrompido. */
export class AdminProvisioningError extends Error {}

export type ProvisionAdminResult =
  | { status: "skipped"; reason: "env-missing" | "password-policy" }
  | { status: "created" | "existing"; email: string };

/** Variáveis de ambiente lidas (ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_PHONE). Aceita `process.env` direto. */
type ProvisionEnv = Record<string, string | undefined>;

function conflictError(role: string) {
  // Sem e-mail, senha ou hash na mensagem: ela vai para o terminal e para logs de CI.
  return new AdminProvisioningError(
    `O e-mail definido em ADMIN_EMAIL já pertence a uma conta com o papel "${role}". ` +
      "Por segurança, o seed não promove contas existentes nem altera suas senhas, então nada foi alterado nessa conta " +
      "e o provisionamento foi interrompido. Defina em ADMIN_EMAIL um e-mail ainda não cadastrado e rode `npm run db:seed` de novo."
  );
}

/**
 * Primeira conta administrativa, criada a partir de variáveis de ambiente. Esse é o único caminho para criar
 * uma conta ADMIN: o cadastro público sempre cria clientes (veja src/app/api/auth/cadastro/route.ts).
 *
 * Regras de segurança (o cadastro público não verifica o e-mail, então qualquer pessoa pode "reservar" um e-mail antes):
 *  - e-mail novo            -> cria a conta ADMIN com a senha de ADMIN_PASSWORD;
 *  - já existe como ADMIN   -> não muda nada (nem a senha): rodar o seed de novo é seguro;
 *  - já existe como CLIENTE -> NUNCA promove: interrompe com AdminProvisioningError. Promover uma linha criada
 *    pelo cadastro público entregaria o painel a quem escolheu a senha dela.
 */
export async function provisionAdmin(db: Pick<PrismaClient, "user">, env: ProvisionEnv): Promise<ProvisionAdminResult> {
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = env.ADMIN_PASSWORD;
  const adminName = env.ADMIN_NAME?.trim() || "Administradora";
  const adminPhone = env.ADMIN_PHONE?.trim() || "(00) 00000-0000";

  if (!adminEmail || !adminPassword) {
    console.warn(
      "ADMIN_EMAIL/ADMIN_PASSWORD não definidos no .env — nenhuma conta administrativa foi criada. " +
        "Defina-os e rode `npm run db:seed` novamente."
    );
    return { status: "skipped", reason: "env-missing" };
  }
  if (/defina-|coloque-/i.test(adminPassword) || !passwordSchema.safeParse(adminPassword).success) {
    console.warn(
      "ADMIN_PASSWORD não atende à política de senha (8 a 72 bytes, nada de senha comum) — conta administrativa não criada."
    );
    return { status: "skipped", reason: "password-policy" };
  }

  const existing = await db.user.findUnique({ where: { email: adminEmail }, select: { role: true } });
  if (existing) {
    if (existing.role !== "ADMIN") throw conflictError(existing.role);
    return { status: "existing", email: adminEmail };
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  try {
    await db.user.create({
      data: { name: adminName, email: adminEmail, phone: adminPhone, passwordHash, role: "ADMIN" },
    });
  } catch (err) {
    // Alguém se cadastrou com esse e-mail entre a leitura e a criação: confere de novo em vez de assumir.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.user.findUnique({ where: { email: adminEmail }, select: { role: true } });
      if (raced?.role === "ADMIN") return { status: "existing", email: adminEmail };
      throw conflictError(raced?.role ?? "desconhecido");
    }
    throw err;
  }
  return { status: "created", email: adminEmail };
}
