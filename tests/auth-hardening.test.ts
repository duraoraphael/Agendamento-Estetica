import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { resetDb, createClient } from "./helpers";
import { prisma } from "@/lib/db";
import { POST as cadastroHandler } from "@/app/api/auth/cadastro/route";
import { authOptions, RATE_LIMITED_ERROR } from "@/lib/auth";
import { getClientIp, hitLimit, limitKey, normalizeEmailForLimit, peekLimit, resetLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_MS, RATE_LIMITS } from "@/lib/constants";
import {
  signupSchema, serviceSchema, loginSchema, passwordSchema, statusUpdateSchema, createBookingSchema, businessHoursSchema,
  isValidTime, utf8ByteLength,
} from "@/lib/validation";
import { isValidDateKey, isValidMonthKey, dateKeyOr } from "@/lib/date-keys";
import { getPeriodRange } from "@/lib/billing";

function post(body: unknown, headers: Record<string, string> = {}) {
  return cadastroHandler(
    new Request("http://localhost/api/auth/cadastro", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );
}

const valid = {
  name: "Maria da Silva",
  email: "maria@example.com",
  phone: "(11) 91234-5678",
  password: "senhaSegura123",
  confirmPassword: "senhaSegura123",
};

function authorizeFn() {
  const provider: any = authOptions.providers[0];
  return (credentials: Record<string, string>, headers: Record<string, string> = {}) =>
    provider.options.authorize(credentials, { headers });
}

describe("Limite de tentativas (rate-limit)", () => {
  beforeEach(resetDb);

  it("bloqueia ao atingir o limite e informa o tempo restante", async () => {
    const key = limitKey("t", "x");
    for (let i = 1; i <= 5; i++) expect((await hitLimit(key, 5)).blocked).toBe(false); // 5 permitidas
    const sixth = await hitLimit(key, 5);
    expect(sixth.blocked).toBe(true);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(RATE_LIMIT_WINDOW_MS / 1000);
    expect((await peekLimit(key, 5)).blocked).toBe(true);
  });

  it("expira depois de 15 minutos e volta a contar do zero", async () => {
    const key = limitKey("t", "y");
    const t0 = new Date("2026-06-01T12:00:00Z");
    for (let i = 0; i < 5; i++) await hitLimit(key, 5, RATE_LIMIT_WINDOW_MS, t0);
    expect((await peekLimit(key, 5, RATE_LIMIT_WINDOW_MS, new Date(t0.getTime() + 14 * 60_000))).blocked).toBe(true);
    const later = new Date(t0.getTime() + RATE_LIMIT_WINDOW_MS + 1);
    expect((await peekLimit(key, 5, RATE_LIMIT_WINDOW_MS, later)).blocked).toBe(false);
    expect((await hitLimit(key, 5, RATE_LIMIT_WINDOW_MS, later)).blocked).toBe(false); // nova janela com 1 tentativa
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(1);
  });

  it("normaliza o e-mail (caixa, espaços, Unicode) para a mesma chave", () => {
    const a = limitKey("e", normalizeEmailForLimit("  Maria@Example.COM "));
    const b = limitKey("e", normalizeEmailForLimit("maria@example.com"));
    const fullwidth = limitKey("e", normalizeEmailForLimit("ｍａｒｉａ@example.com")); // caracteres de largura total
    expect(a).toBe(b);
    expect(fullwidth).toBe(b);
  });

  it("não guarda o e-mail em claro", async () => {
    await hitLimit(limitKey("login-email", "segredo@example.com"), 5);
    const rows = await prisma.rateLimit.findMany();
    expect(JSON.stringify(rows)).not.toContain("segredo@example.com");
  });

  it("rajada paralela numa chave NOVA conta todas as tentativas (sem corrida de criação)", async () => {
    const key = limitKey("t", "cold");
    await Promise.all(Array.from({ length: 40 }, () => hitLimit(key, 5)));
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(40);
  });

  it("rajada paralela sobre janela EXPIRADA reinicia uma vez e conta todas", async () => {
    const key = limitKey("t", "expired");
    const t0 = new Date("2026-06-01T12:00:00Z");
    await hitLimit(key, 5, RATE_LIMIT_WINDOW_MS, t0);
    const later = new Date(t0.getTime() + RATE_LIMIT_WINDOW_MS + 5000);
    await Promise.all(Array.from({ length: 30 }, () => hitLimit(key, 5, RATE_LIMIT_WINDOW_MS, later)));
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(30);
  });

  it("reset zera o contador", async () => {
    const key = limitKey("t", "z");
    for (let i = 0; i < 5; i++) await hitLimit(key, 5);
    await resetLimit(key);
    expect((await peekLimit(key, 5)).blocked).toBe(false);
  });

  it("contagem é compartilhada: incrementos concorrentes não se perdem", async () => {
    const key = limitKey("t", "c");
    await hitLimit(key, 100); // abre a janela
    await Promise.all(Array.from({ length: 20 }, () => hitLimit(key, 100)));
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(21);
  });
});

describe("Origem do IP conforme o proxy configurado", () => {
  const h = (xff?: string) => ({ get: (n: string) => (n === "x-forwarded-for" && xff ? xff : null) });

  it("sem proxy confiável declarado, ignora X-Forwarded-For (forjável)", () => {
    expect(getClientIp(h("6.6.6.6"), {})).toBeNull();
    expect(getClientIp(h("6.6.6.6"), { TRUSTED_PROXY_HOPS: "0" })).toBeNull();
    expect(getClientIp(h("6.6.6.6"), { TRUSTED_PROXY_HOPS: "abc" })).toBeNull();
  });

  it("com 1 proxy confiável, usa a última entrada (a que o proxy viu), não a forjada pelo cliente", () => {
    // O cliente enviou "6.6.6.6"; o proxy acrescentou o IP real "203.0.113.9".
    expect(getClientIp(h("6.6.6.6, 203.0.113.9"), { TRUSTED_PROXY_HOPS: "1" })).toBe("203.0.113.9");
  });

  it("com 2 proxies confiáveis, usa a penúltima entrada", () => {
    expect(getClientIp(h("6.6.6.6, 203.0.113.9, 10.0.0.2"), { TRUSTED_PROXY_HOPS: "2" })).toBe("203.0.113.9");
  });

  it("rejeita valores que não são IP e cadeias mais curtas que o esperado; aceita IPv6", () => {
    expect(getClientIp(h("lixo"), { TRUSTED_PROXY_HOPS: "1" })).toBeNull();
    expect(getClientIp(h("1.2.3.4"), { TRUSTED_PROXY_HOPS: "2" })).toBeNull();
    expect(getClientIp(h(undefined), { TRUSTED_PROXY_HOPS: "1" })).toBeNull();
    expect(getClientIp(h("2001:db8::1"), { TRUSTED_PROXY_HOPS: "1" })).toBe("2001:db8::1");
  });
});

describe("Login: limite, resposta genérica e tempo constante (achado 5)", () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it("5 falhas bloqueiam o e-mail; depois até a senha certa é recusada com RATE_LIMITED", async () => {
    const c = await createClient({ email: "lim@example.com", password: "SenhaBoa#2026" });
    const authorize = authorizeFn();
    for (let i = 0; i < RATE_LIMITS.loginEmail; i++) {
      expect(await authorize({ email: "lim@example.com", password: "errada" + i })).toBeNull();
    }
    await expect(authorize({ email: "lim@example.com", password: c.plainPassword })).rejects.toThrow(RATE_LIMITED_ERROR);
  });

  it("rajada paralela de 30 senhas erradas: só 5 chegam a ser testadas, o resto é barrado", async () => {
    await createClient({ email: "burst@example.com", password: "SenhaBoa#2026" });
    const spy = vi.spyOn(bcrypt, "compare");
    const authorize = authorizeFn();
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) => authorize({ email: "burst@example.com", password: "tentativa-" + i }))
    );
    const tested = results.filter((r) => r.status === "fulfilled").length; // chegaram a comparar a senha
    const blocked = results.filter((r) => r.status === "rejected" && String((r as PromiseRejectedResult).reason).includes(RATE_LIMITED_ERROR)).length;
    // Garantia de segurança: NUNCA mais que o limite chega a testar senha. (Numa rajada, cada chamada lê a
    // contagem depois dos incrementos das outras, então o limitador é conservador e pode barrar também
    // algumas das primeiras; em tentativas sequenciais o limite é exatamente 5.)
    expect(tested).toBeGreaterThanOrEqual(1);
    expect(tested).toBeLessThanOrEqual(RATE_LIMITS.loginEmail);
    expect(blocked).toBe(30 - tested);
    expect(spy).toHaveBeenCalledTimes(tested);
  });

  it("e-mail inexistente é bloqueado do mesmo jeito (não revela se a conta existe)", async () => {
    const authorize = authorizeFn();
    for (let i = 0; i < RATE_LIMITS.loginEmail; i++) await authorize({ email: "ninguem@example.com", password: "x" + i });
    await expect(authorize({ email: "ninguem@example.com", password: "qualquer" })).rejects.toThrow(RATE_LIMITED_ERROR);
  });

  it("normaliza o e-mail: variações de caixa/espaço compartilham o mesmo contador", async () => {
    const authorize = authorizeFn();
    const variants = ["Lim2@Example.com", "lim2@example.com ", " LIM2@EXAMPLE.COM", "lim2@example.com", "Lim2@example.com"];
    for (const v of variants) await authorize({ email: v, password: "errada" });
    await expect(authorize({ email: "lim2@example.com", password: "errada" })).rejects.toThrow(RATE_LIMITED_ERROR);
  });

  it("login correto zera o contador do e-mail", async () => {
    const c = await createClient({ email: "ok@example.com", password: "SenhaBoa#2026" });
    const authorize = authorizeFn();
    for (let i = 0; i < 3; i++) await authorize({ email: "ok@example.com", password: "errada" });
    expect(await authorize({ email: "ok@example.com", password: c.plainPassword })).not.toBeNull();
    for (let i = 0; i < 4; i++) await authorize({ email: "ok@example.com", password: "errada" });
    expect(await authorize({ email: "ok@example.com", password: c.plainPassword })).not.toBeNull(); // 4 < 5: ainda liberado
  });

  it("limite por IP só vale com proxy confiável declarado e usa o IP certo", async () => {
    const prev = process.env.TRUSTED_PROXY_HOPS;
    process.env.TRUSTED_PROXY_HOPS = "1";
    try {
      const authorize = authorizeFn();
      const headers = { "x-forwarded-for": "6.6.6.6, 203.0.113.50" };
      for (let i = 0; i < RATE_LIMITS.loginIp; i++) {
        await authorize({ email: `alvo${i}@example.com`, password: "errada" }, headers); // e-mails diferentes
      }
      await expect(authorize({ email: "novo@example.com", password: "x" }, headers)).rejects.toThrow(RATE_LIMITED_ERROR);
      // Outro IP (e outro e-mail) não é afetado.
      expect(await authorize({ email: "novo@example.com", password: "x" }, { "x-forwarded-for": "6.6.6.6, 198.51.100.7" })).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = prev;
    }
  });

  it("e-mail inexistente também executa a comparação bcrypt (tempo equivalente)", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    const authorize = authorizeFn();
    expect(await authorize({ email: "fantasma@example.com", password: "qualquer-coisa" })).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockClear();
    await createClient({ email: "real@example.com", password: "SenhaBoa#2026" });
    expect(await authorize({ email: "real@example.com", password: "errada" })).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("entrada malformada recebe a mesma resposta genérica (null), não um erro diferente", async () => {
    const authorize = authorizeFn();
    expect(await authorize({ email: "nao-e-email", password: "x" })).toBeNull();
    expect(await authorize({ email: "a@b.com", password: "x".repeat(5000) })).toBeNull();
    expect(await authorize({ email: "", password: "" })).toBeNull();
  });

  it("contas antigas continuam entrando (senha curta/comum criada antes da nova política)", async () => {
    await createClient({ email: "antiga@example.com", password: "12345678" }); // seria recusada hoje no cadastro
    expect(await authorizeFn()({ email: "antiga@example.com", password: "12345678" })).not.toBeNull();
  });
});

describe("Cadastro: resposta uniforme, limite e política de senha (achados 5 e 7)", () => {
  beforeEach(resetDb);

  it("e-mail novo e e-mail existente devolvem status e corpo idênticos", async () => {
    const novo = await post(valid);
    const novoBody = await novo.json();
    const existente = await post({ ...valid, name: "Outra Pessoa", password: "OutraSenha#99", confirmPassword: "OutraSenha#99" });
    expect(existente.status).toBe(novo.status);
    expect(await existente.json()).toEqual(novoBody);
    // A conta original não foi alterada (senha e nome preservados).
    const user = await prisma.user.findUniqueOrThrow({ where: { email: valid.email } });
    expect(user.name).toBe("Maria da Silva");
    expect(await bcrypt.compare(valid.password, user.passwordHash)).toBe(true);
  });

  it("cadastro simultâneo do mesmo e-mail não gera erro 500 nem conta duplicada", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => post(valid)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.user.count({ where: { email: valid.email } })).toBe(1);
  });

  it("bloqueia o 6º cadastro para o mesmo e-mail com 429 e Retry-After", async () => {
    for (let i = 0; i < RATE_LIMITS.signupEmail; i++) expect((await post(valid)).status).toBe(200);
    const blocked = await post(valid);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("e-mail com caixa/espaços diferentes cai no mesmo limite", async () => {
    for (let i = 0; i < RATE_LIMITS.signupEmail; i++) await post({ ...valid, email: i % 2 ? " MARIA@Example.com" : "maria@example.com" });
    expect((await post({ ...valid, email: "Maria@EXAMPLE.com" })).status).toBe(429);
  });

  it("ignora X-Forwarded-For forjado quando não há proxy confiável (limite por IP desativado)", async () => {
    // Sem TRUSTED_PROXY_HOPS, o cabeçalho não vira chave: não há como burlar nem como punir terceiros por ele.
    for (let i = 0; i < RATE_LIMITS.signupIp + 1; i++) {
      const res = await post({ ...valid, email: `u${i}@example.com` }, { "x-forwarded-for": "1.1.1.1" });
      expect(res.status).toBe(200);
    }
  });

  it("limite por IP com proxy confiável", async () => {
    const prev = process.env.TRUSTED_PROXY_HOPS;
    process.env.TRUSTED_PROXY_HOPS = "1";
    try {
      for (let i = 0; i < RATE_LIMITS.signupIp; i++) {
        expect((await post({ ...valid, email: `ip${i}@example.com` }, { "x-forwarded-for": "9.9.9.9, 203.0.113.77" })).status).toBe(200);
      }
      expect((await post({ ...valid, email: "ipx@example.com" }, { "x-forwarded-for": "9.9.9.9, 203.0.113.77" })).status).toBe(429);
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = prev;
    }
  });

  it("recusa senha comum e senha acima de 72 bytes UTF-8 sem truncar", async () => {
    const weak = await post({ ...valid, email: "w@example.com", password: "12345678", confirmPassword: "12345678" });
    expect(weak.status).toBe(400);
    const long = "a".repeat(73);
    const tooLong = await post({ ...valid, email: "l@example.com", password: long, confirmPassword: long });
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).errors.password).toMatch(/longa demais/);
    expect(await prisma.user.count()).toBe(0);
  });
});

describe("Validação de tamanhos e formatos (achado 7)", () => {
  const base = { name: "Maria da Silva", email: "m@example.com", phone: "(11) 91234-5678", password: "SenhaBoa#2026", confirmPassword: "SenhaBoa#2026" };

  it("senha: 72 bytes ASCII passa; 73 não; acentos contam em bytes (37 × 'é' = 74 bytes)", () => {
    expect(passwordSchema.safeParse("a1".repeat(36)).success).toBe(true); // 72 bytes
    expect(passwordSchema.safeParse("a1".repeat(36) + "b").success).toBe(false); // 73 bytes
    const accented = "é".repeat(37); // 37 caracteres, 74 bytes
    expect(accented.length).toBe(37);
    expect(utf8ByteLength(accented)).toBe(74);
    expect(passwordSchema.safeParse(accented).success).toBe(false);
    expect(passwordSchema.safeParse("aé".repeat(24)).success).toBe(true); // (1+2) × 24 = 72 bytes exatos
    expect(passwordSchema.safeParse("😀😃".repeat(9)).success).toBe(true); // 18 emojis × 4 = 72 bytes
    expect(passwordSchema.safeParse("😀😃".repeat(9) + "😀").success).toBe(false); // 76 bytes
  });

  it("senha: comuns e repetidas recusadas; mínimo de 8", () => {
    for (const p of ["12345678", "Password123", "aaaaaaaa", "short"]) expect(passwordSchema.safeParse(p).success).toBe(false);
    expect(passwordSchema.safeParse("Tulipa-Rosa-42").success).toBe(true);
  });

  it("limites de nome, e-mail e celular", () => {
    expect(signupSchema.safeParse(base).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, name: "A".repeat(101) + " B" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, email: "a".repeat(250) + "@x.com" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, phone: "(11) 91234-5678" + "9".repeat(30) }).success).toBe(false);
  });

  it("login aceita senhas antigas longas até 1024 bytes, mas não arbitrariamente grandes", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x".repeat(200) }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x".repeat(2000) }).success).toBe(false);
  });

  it("serviço: preço e duração dentro de limites coerentes", () => {
    const ok = { name: "Esmaltação", priceCents: 6000, durationMinutes: 60, active: true };
    expect(serviceSchema.safeParse(ok).success).toBe(true);
    expect(serviceSchema.safeParse({ ...ok, priceCents: 500_001 }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...ok, durationMinutes: 481 }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...ok, durationMinutes: 4 }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...ok, name: "x".repeat(81) }).success).toBe(false);
  });

  it("schemas de reserva e status rejeitam entradas forjadas", () => {
    expect(statusUpdateSchema.safeParse({ status: "FOO" }).success).toBe(false);
    expect(statusUpdateSchema.safeParse({ status: "CONFIRMADA" }).success).toBe(true);
    expect(createBookingSchema.safeParse({ serviceId: "s1", startAtIso: "abc" }).success).toBe(false);
    expect(createBookingSchema.safeParse({ serviceId: "", startAtIso: "2026-12-01T13:00:00.000Z" }).success).toBe(false);
    expect(createBookingSchema.safeParse({ serviceId: "s1", startAtIso: "2026-12-01T13:00:00.000Z" }).success).toBe(true);
  });
});

describe("Expediente e horas (revisão independente)", () => {
  const day = { dayOfWeek: 2, active: true, startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" };

  it("isValidTime aceita horas normais (regressão: uma regex quebrada recusava todas)", () => {
    for (const ok of ["00:00", "09:00", "13:30", "23:59"]) expect(isValidTime(ok)).toBe(true);
    for (const bad of ["24:00", "9:00", "12:60", "ab:cd", "", undefined]) expect(isValidTime(bad)).toBe(false);
  });

  it("almoço precisa caber dentro do expediente", () => {
    expect(businessHoursSchema.safeParse(day).success).toBe(true);
    expect(businessHoursSchema.safeParse({ ...day, breakStart: "19:00", breakEnd: "20:00" }).success).toBe(false);
    expect(businessHoursSchema.safeParse({ ...day, breakStart: "07:00", breakEnd: "08:00" }).success).toBe(false);
    expect(businessHoursSchema.safeParse({ ...day, breakStart: "", breakEnd: "" }).success).toBe(true);
  });
});

describe("Chaves de data de filtros (achado 9)", () => {
  it("valida o calendário real, não só o formato", () => {
    expect(isValidDateKey("2026-11-04")).toBe(true);
    for (const bad of ["abc", "2026-13-45", "2026-02-30", "2026-00-10", "2026-1-1", "", undefined, "2026-11-04\n"]) {
      expect(isValidDateKey(bad as any)).toBe(false);
    }
    expect(isValidMonthKey("2026-11")).toBe(true);
    for (const bad of ["zzz", "2026-13", "2026-00", "2026"]) expect(isValidMonthKey(bad)).toBe(false);
    expect(dateKeyOr("abc", "2026-01-01")).toBe("2026-01-01");
  });

  it("getPeriodRange nunca devolve Invalid Date para referência inválida", () => {
    for (const kind of ["DIARIO", "SEMANAL", "MENSAL"] as const) {
      const r = getPeriodRange(kind, "abc");
      expect(Number.isNaN(r.start.getTime())).toBe(false);
      expect(Number.isNaN(r.end.getTime())).toBe(false);
    }
  });
});

describe("Cabeçalhos de segurança (achado 6)", () => {
  it("define CSP, frames, nosniff, referrer e desativa X-Powered-By; HSTS só em produção", async () => {
    const dev = (await import("../next.config.mjs")).default as any;
    expect(dev.poweredByHeader).toBe(false);
    const [{ headers }] = await dev.headers();
    const map = Object.fromEntries(headers.map((h: any) => [h.key, h.value]));
    expect(map["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/);
    expect(map["Content-Security-Policy"]).toMatch(/object-src 'none'/);
    expect(map["Content-Security-Policy"]).toMatch(/form-action 'self' https:\/\/accounts\.google\.com/);
    expect(map["X-Frame-Options"]).toBe("DENY");
    expect(map["X-Content-Type-Options"]).toBe("nosniff");
    expect(map["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(map["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(map["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(map["Strict-Transport-Security"]).toBeUndefined(); // NODE_ENV=test
  });

  it("em produção com HTTPS inclui HSTS e remove 'unsafe-eval'; com HTTP local não força HTTPS", async () => {
    vi.resetModules();
    const prev = process.env.NODE_ENV;
    const prevUrl = process.env.NEXTAUTH_URL;
    (process.env as any).NODE_ENV = "production";
    process.env.NEXTAUTH_URL = "https://agenda.example.com";
    try {
      const prod = (await import("../next.config.mjs?prod")).default as any;
      const [{ headers }] = await prod.headers();
      const map = Object.fromEntries(headers.map((h: any) => [h.key, h.value]));
      expect(map["Strict-Transport-Security"]).toMatch(/max-age=\d+; includeSubDomains/);
      expect(map["Content-Security-Policy"]).not.toMatch(/unsafe-eval/);
      expect(map["Content-Security-Policy"]).toMatch(/upgrade-insecure-requests/);

      process.env.NEXTAUTH_URL = "http://localhost:3000";
      const local = (await import("../next.config.mjs?prod-http")).default as any;
      const [{ headers: localHeaders }] = await local.headers();
      const localMap = Object.fromEntries(localHeaders.map((h: any) => [h.key, h.value]));
      expect(localMap["Strict-Transport-Security"]).toBeUndefined();
      expect(localMap["Content-Security-Policy"]).not.toMatch(/upgrade-insecure-requests/);
    } finally {
      (process.env as any).NODE_ENV = prev;
      process.env.NEXTAUTH_URL = prevUrl;
    }
  });
});
