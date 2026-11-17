import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, createClient } from "./helpers";
import { prisma } from "@/lib/db";
import { authOptions, RATE_LIMITED_ERROR } from "@/lib/auth";
import { RATE_LIMITS } from "@/lib/constants";
import { limitKey, normalizeEmailForLimit } from "@/lib/rate-limit";

function authorizeFn() {
  const provider: any = authOptions.providers[0];
  return (credentials: Record<string, string>, headers: Record<string, string> = {}) =>
    provider.options.authorize(credentials, { headers });
}
/** Com TRUSTED_PROXY_HOPS=1 o IP confiável é a ÚLTIMA entrada de X-Forwarded-For (a que o proxy confiável registrou). */
const from = (ip: string) => ({ "x-forwarded-for": `1.2.3.4, ${ip}` });

describe("Login: terceiros não esgotam o acesso da dona da conta (achado 7)", () => {
  const prevHops = process.env.TRUSTED_PROXY_HOPS;
  const VICTIM = "vitima@example.com";
  let password: string;
  const authorize = authorizeFn();

  beforeEach(async () => {
    await resetDb();
    password = (await createClient({ email: VICTIM, password: "SenhaBoa#2026" })).plainPassword;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    if (prevHops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = prevHops;
    vi.restoreAllMocks();
  });

  describe("com proxy confiável declarado (origem validada)", () => {
    beforeEach(() => {
      process.env.TRUSTED_PROXY_HOPS = "1";
    });

    it("o atacante é barrado depois de 5 falhas, mas a dona (outra origem) entra normalmente", async () => {
      for (let i = 0; i < RATE_LIMITS.loginEmail; i++) {
        expect(await authorize({ email: VICTIM, password: "chute" + i }, from("203.0.113.66"))).toBeNull();
      }
      // A origem abusiva continua limitada — inclusive com a senha CERTA.
      await expect(authorize({ email: VICTIM, password }, from("203.0.113.66"))).rejects.toThrow(RATE_LIMITED_ERROR);
      await expect(authorize({ email: VICTIM, password: "outro-chute" }, from("203.0.113.66"))).rejects.toThrow(RATE_LIMITED_ERROR);

      // A dona, de outra origem, não é afetada.
      expect(await authorize({ email: VICTIM, password }, from("198.51.100.7"))).not.toBeNull();
    });

    it("a dona também tem o próprio limite: 5 falhas dela bloqueiam só o par dela", async () => {
      for (let i = 0; i < RATE_LIMITS.loginEmail; i++) await authorize({ email: VICTIM, password: "errei" + i }, from("198.51.100.7"));
      await expect(authorize({ email: VICTIM, password }, from("198.51.100.7"))).rejects.toThrow(RATE_LIMITED_ERROR);
      // Outra origem com a senha certa (ex.: a dona no celular, em outra rede) continua entrando.
      expect(await authorize({ email: VICTIM, password }, from("198.51.100.8"))).not.toBeNull();
    });

    it("uma origem testando muitos e-mails é barrada por origem (limite por IP)", async () => {
      for (let i = 0; i < RATE_LIMITS.loginIp; i++) await authorize({ email: `alvo${i}@example.com`, password: "x" }, from("203.0.113.66"));
      await expect(authorize({ email: "novo@example.com", password: "x" }, from("203.0.113.66"))).rejects.toThrow(RATE_LIMITED_ERROR);
      expect(await authorize({ email: VICTIM, password }, from("198.51.100.7"))).not.toBeNull();
    });

    it("uma origem barrada insistindo NÃO esgota o teto compartilhado da conta", async () => {
      for (let i = 0; i < 40; i++) await authorize({ email: VICTIM, password: "chute" + i }, from("203.0.113.66")).catch(() => null);
      const row = await prisma.rateLimit.findUnique({ where: { key: limitKey("login-email", normalizeEmailForLimit(VICTIM)) } });
      expect(row?.count).toBeLessThanOrEqual(RATE_LIMITS.loginEmail); // só as 5 que passaram do limite da origem
      expect(await authorize({ email: VICTIM, password }, from("198.51.100.7"))).not.toBeNull();
    });

    it("login legítimo não apaga as falhas de OUTRAS origens: o atacante segue barrado", async () => {
      for (let i = 0; i < RATE_LIMITS.loginEmail; i++) await authorize({ email: VICTIM, password: "chute" + i }, from("203.0.113.66"));
      expect(await authorize({ email: VICTIM, password }, from("198.51.100.7"))).not.toBeNull();
      await expect(authorize({ email: VICTIM, password }, from("203.0.113.66"))).rejects.toThrow(RATE_LIMITED_ERROR);
    });

    it("ataque distribuído (muitas origens, 5 falhas cada) esbarra no teto por e-mail", async () => {
      const sources = Math.ceil(RATE_LIMITS.loginEmailAnySource / RATE_LIMITS.loginEmail); // 10 origens x 5 = 50
      for (let s = 0; s < sources; s++) {
        for (let i = 0; i < RATE_LIMITS.loginEmail; i++) await authorize({ email: VICTIM, password: `chute${s}-${i}` }, from(`203.0.113.${100 + s}`));
      }
      // Uma origem nova, nunca vista, já encontra o teto da conta esgotado.
      await expect(authorize({ email: VICTIM, password: "mais-um" }, from("203.0.113.250"))).rejects.toThrow(RATE_LIMITED_ERROR);
    }, 60_000);

    it("respostas continuam genéricas: falha = null, bloqueio = RATE_LIMITED igual para e-mail existente ou não", async () => {
      expect(await authorize({ email: VICTIM, password: "errada" }, from("203.0.113.66"))).toBeNull();
      expect(await authorize({ email: "fantasma@example.com", password: "errada" }, from("203.0.113.66"))).toBeNull();
      // Uma tentativa já foi feita acima com este e-mail/origem: com mais 4 chegam a 5 (liberadas); a 6ª é barrada.
      for (let i = 0; i < RATE_LIMITS.loginEmail - 1; i++) expect(await authorize({ email: "fantasma@example.com", password: "x" }, from("203.0.113.66"))).toBeNull();
      await expect(authorize({ email: "fantasma@example.com", password: "x" }, from("203.0.113.66"))).rejects.toThrow(RATE_LIMITED_ERROR);
    });
  });

  describe("sem proxy confiável (cabeçalhos do cliente não são confiáveis)", () => {
    beforeEach(() => {
      delete process.env.TRUSTED_PROXY_HOPS;
    });

    it("X-Forwarded-For forjado e trocado a cada tentativa NÃO burla o limite por e-mail", async () => {
      for (let i = 0; i < RATE_LIMITS.loginEmail; i++) {
        await authorize({ email: VICTIM, password: "chute" + i }, { "x-forwarded-for": `9.9.9.${i}` });
      }
      await expect(authorize({ email: VICTIM, password: "mais-um" }, { "x-forwarded-for": "9.9.9.200" })).rejects.toThrow(RATE_LIMITED_ERROR);
    });

    it("não cria contadores por origem: só o do e-mail", async () => {
      await authorize({ email: VICTIM, password: "x" }, { "x-forwarded-for": "9.9.9.9" });
      const keys = (await prisma.rateLimit.findMany()).map((r) => r.key.split(":")[0]);
      expect(keys).toEqual(["login-email"]);
    });
  });
});
