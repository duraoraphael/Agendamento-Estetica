import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, createAdmin } from "./helpers";
import { prisma } from "@/lib/db";
import { POST as cadastroHandler } from "@/app/api/auth/cadastro/route";
import { authOptions } from "@/lib/auth";

function postCadastro(body: unknown) {
  return cadastroHandler(
    new Request("http://localhost/api/auth/cadastro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const validSignup = {
  name: "Maria da Silva",
  email: "maria@example.com",
  phone: "(11) 91234-5678",
  password: "senhaSegura123",
  confirmPassword: "senhaSegura123",
  consent: true,
};

describe("Cadastro público", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria uma conta CLIENTE com os dados válidos", async () => {
    const res = await postCadastro(validSignup);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    const user = await prisma.user.findUnique({ where: { email: "maria@example.com" } });
    expect(user).not.toBeNull();
    expect(user?.role).toBe("CLIENTE");
    expect(user?.passwordHash).not.toBe("senhaSegura123"); // precisa estar hasheada
  });

  it("nunca cria uma conta ADMIN mesmo que o corpo da requisição envie role=ADMIN", async () => {
    const res = await postCadastro({ ...validSignup, role: "ADMIN" });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: validSignup.email } });
    expect(user?.role).toBe("CLIENTE");
  });

  it("responde igual para e-mail novo e já cadastrado (não revela quem tem conta) e não duplica a conta", async () => {
    const first = await postCadastro(validSignup);
    const second = await postCadastro(validSignup);

    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(await first.json());
    expect(await prisma.user.count({ where: { email: validSignup.email } })).toBe(1);
  });

  it("exige o consentimento de uso dos dados no SERVIDOR (LGPD): sem consent=true não cria a conta", async () => {
    for (const consent of [undefined, false, "true", 1]) {
      const res = await postCadastro({ ...validSignup, consent });
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.errors.consent).toBeDefined();
    }
    expect(await prisma.user.count({ where: { email: validSignup.email } })).toBe(0);
  });

  it("valida senhas que não coincidem", async () => {
    const res = await postCadastro({ ...validSignup, confirmPassword: "outraSenha" });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.errors.confirmPassword).toBeDefined();
  });

  it("valida celular sem DDD/formato inválido", async () => {
    const res = await postCadastro({ ...validSignup, phone: "123" });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.errors.phone).toBeDefined();
  });

  it("valida senha curta", async () => {
    const res = await postCadastro({ ...validSignup, password: "123", confirmPassword: "123" });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.errors.password).toBeDefined();
  });
});

// No next-auth v4, o factory CredentialsProvider() devolve um objeto com um
// `authorize` placeholder (`() => null`); a função real passada por nós fica
// em `provider.options.authorize` — é lá que o core do next-auth busca na
// hora de autenticar. Por isso o teste chama `provider.options.authorize`.
function getAuthorizeFn() {
  const provider = authOptions.providers[0] as unknown as {
    options: { authorize: (c: Record<string, string>) => Promise<{ id: string; role: string } | null> };
  };
  return provider.options.authorize;
}

describe("Login (autorização de credenciais)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("autentica cliente com senha correta e devolve o papel CLIENTE", async () => {
    await postCadastro(validSignup);
    const authorize = getAuthorizeFn();

    const user = await authorize({ email: validSignup.email, password: validSignup.password });
    expect(user).not.toBeNull();
    expect(user?.role).toBe("CLIENTE");
  });

  it("autentica administradora com o papel ADMIN", async () => {
    const admin = await createAdmin();
    const authorize = getAuthorizeFn();

    const user = await authorize({ email: admin.email, password: admin.plainPassword });
    expect(user).not.toBeNull();
    expect(user?.role).toBe("ADMIN");
  });

  it("rejeita senha incorreta", async () => {
    await postCadastro(validSignup);
    const authorize = getAuthorizeFn();

    const user = await authorize({ email: validSignup.email, password: "senhaErrada" });
    expect(user).toBeNull();
  });

  it("rejeita e-mail inexistente", async () => {
    const authorize = getAuthorizeFn();
    const user = await authorize({ email: "ninguem@example.com", password: "qualquer" });
    expect(user).toBeNull();
  });
});
