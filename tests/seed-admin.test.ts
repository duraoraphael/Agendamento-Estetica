import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { resetDb, createClient, createAdmin } from "./helpers";
import { prisma } from "@/lib/db";
import { AdminProvisioningError, provisionAdmin } from "../prisma/provision-admin";

const env = (over: Record<string, string | undefined> = {}) => ({
  ADMIN_EMAIL: "dona@garage.example.com",
  ADMIN_PASSWORD: "Tulipa-Rosa-42",
  ADMIN_NAME: "Dona da Garage",
  ...over,
});

describe("Seed: conta administrativa (nunca promove nem altera conta existente)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("e-mail novo: cria a conta ADMIN com a senha informada", async () => {
    const r = await provisionAdmin(prisma, env());
    expect(r).toEqual({ status: "created", email: "dona@garage.example.com" });
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "dona@garage.example.com" } });
    expect(u.role).toBe("ADMIN");
    expect(await bcrypt.compare("Tulipa-Rosa-42", u.passwordHash)).toBe(true);
  });

  it("rodar de novo é seguro: não muda papel, senha nem dados da conta ADMIN existente", async () => {
    await provisionAdmin(prisma, env());
    const before = await prisma.user.findUniqueOrThrow({ where: { email: "dona@garage.example.com" } });

    // Mesmo com outra ADMIN_PASSWORD no .env, o seed não troca a senha existente.
    const again = await provisionAdmin(prisma, env({ ADMIN_PASSWORD: "Outra-Senha-99", ADMIN_NAME: "Outro Nome" }));
    expect(again.status).toBe("existing");

    const after = await prisma.user.findUniqueOrThrow({ where: { email: "dona@garage.example.com" } });
    expect(after).toEqual(before);
    expect(await prisma.user.count()).toBe(1);
  });

  it("e-mail que já é de uma CLIENTE: interrompe com erro, sem promover e sem tocar na senha", async () => {
    // Cenário do achado: alguém se cadastrou (sem verificação de e-mail) com o e-mail reservado ao administrador.
    const squatter = await createClient({ email: "dona@garage.example.com", password: "SenhaDoInvasor#1" });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: squatter.id } });

    await expect(provisionAdmin(prisma, env())).rejects.toBeInstanceOf(AdminProvisioningError);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: squatter.id } });
    expect(after.role).toBe("CLIENTE");
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(0);
  });

  it("a mensagem de erro é clara e não expõe e-mail, senha nem hash", async () => {
    const squatter = await createClient({ email: "dona@garage.example.com", password: "SenhaDoInvasor#1" });
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: squatter.id } })).passwordHash;
    const err = await provisionAdmin(prisma, env()).catch((e) => e as Error);
    expect(err).toBeInstanceOf(AdminProvisioningError);
    expect(err.message).toMatch(/ADMIN_EMAIL/);
    expect(err.message).toMatch(/CLIENTE/);
    for (const secret of ["Tulipa-Rosa-42", "SenhaDoInvasor#1", hash, "dona@garage.example.com"]) {
      expect(err.message).not.toContain(secret);
    }
  });

  it("compara o e-mail normalizado (caixa e espaços)", async () => {
    await createClient({ email: "dona@garage.example.com" });
    await expect(provisionAdmin(prisma, env({ ADMIN_EMAIL: "  Dona@Garage.EXAMPLE.com " }))).rejects.toBeInstanceOf(AdminProvisioningError);
  });

  it("corrida: cadastro público cria o e-mail entre a leitura e a criação -> reconfere e interrompe", async () => {
    const dup = new Prisma.PrismaClientKnownRequestError("duplicado", { code: "P2002", clientVersion: "5.22.0" });
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ role: "CLIENTE" }),
        create: vi.fn().mockRejectedValue(dup),
      },
    } as never;
    await expect(provisionAdmin(db, env())).rejects.toBeInstanceOf(AdminProvisioningError);
  });

  it("corrida em que a outra execução criou a ADMIN: trata como já existente", async () => {
    const dup = new Prisma.PrismaClientKnownRequestError("duplicado", { code: "P2002", clientVersion: "5.22.0" });
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ role: "ADMIN" }),
        create: vi.fn().mockRejectedValue(dup),
      },
    } as never;
    expect((await provisionAdmin(db, env())).status).toBe("existing");
  });

  it("sem ADMIN_EMAIL/ADMIN_PASSWORD, ou com senha fraca: não cria nada", async () => {
    expect(await provisionAdmin(prisma, env({ ADMIN_EMAIL: undefined }))).toEqual({ status: "skipped", reason: "env-missing" });
    expect(await provisionAdmin(prisma, env({ ADMIN_PASSWORD: "12345678" }))).toEqual({ status: "skipped", reason: "password-policy" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("uma conta ADMIN criada à mão com outro e-mail não é afetada", async () => {
    const other = await createAdmin({ email: "outra@garage.example.com" });
    await provisionAdmin(prisma, env());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).passwordHash).toBe(other.passwordHash);
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(2);
  });
});

// O seed roda de verdade, em outro processo, contra o PostgreSQL local e descartável dos testes.
describe("Seed executado de verdade (prisma/seed.ts, PostgreSQL descartável de teste)", () => {
  const root = path.resolve(__dirname, "..");
  const run = (extra: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      // DATABASE_URL/DIRECT_URL já são as do PostgreSQL de teste (vitest.config.ts); e-mail fictício: nunca o Supabase.
      env: { ...process.env, ADMIN_PASSWORD: "Tulipa-Rosa-42", ...extra },
    });

  beforeEach(resetDb);

  it("e-mail de cliente: termina com código 1, mensagem clara e sem expor credenciais", async () => {
    await createClient({ email: "seed.conflito@example.com", password: "SenhaDoInvasor#1" });
    const r = run({ ADMIN_EMAIL: "seed.conflito@example.com" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Seed interrompido/);
    expect(r.stderr).not.toContain("Tulipa-Rosa-42");
    expect(r.stderr).not.toContain("SenhaDoInvasor#1");
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "seed.conflito@example.com" } })).role).toBe("CLIENTE");
  });

  it("e-mail novo: cria a ADMIN; segunda execução termina bem e preserva a conta", async () => {
    const first = run({ ADMIN_EMAIL: "seed.novo@example.com" });
    expect(first.status).toBe(0);
    const created = await prisma.user.findUniqueOrThrow({ where: { email: "seed.novo@example.com" } });
    expect(created.role).toBe("ADMIN");

    const second = run({ ADMIN_EMAIL: "seed.novo@example.com", ADMIN_PASSWORD: "Outra-Senha-99" });
    expect(second.status).toBe(0);
    expect(await prisma.user.findUniqueOrThrow({ where: { email: "seed.novo@example.com" } })).toEqual(created);
  }, 120_000);
});
