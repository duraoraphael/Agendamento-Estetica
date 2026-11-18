import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, createAdmin, createClient } from "./helpers";
import { prisma } from "@/lib/db";
import { LOGO_MAX_BYTES, LogoValidationError, validateLogo } from "@/lib/logo-image";
import { loadSiteSettings, normalizeInstagram, saveSiteSettings, siteSettingsSchema, whatsappLink } from "@/lib/site-settings";
import { DEFAULT_SITE } from "@/lib/site";

// ---- imagens sintéticas (só o cabeçalho importa para a validação) ----
function png(w: number, h: number, total = 200): Uint8Array {
  const b = new Uint8Array(total);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
function jpeg(w: number, h: number): Uint8Array {
  // SOI + APP0 (16 bytes) + SOF0 com altura/largura
  const b = new Uint8Array(2 + 18 + 19 + 4);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0, 0, 1, 0, 1, 0, 0]);
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 20);
  return b;
}
function webpLossless(w: number, h: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0, 0, 0, 0, 0x2f]);
  const bits = (w - 1) | ((h - 1) << 14);
  new DataView(b.buffer).setUint32(21, bits, true);
  return b;
}

describe("Logo: validação no servidor", () => {
  it("aceita PNG, JPEG e WebP válidos e lê as dimensões do próprio arquivo", () => {
    expect(validateLogo(png(512, 300), "image/png")).toMatchObject({ contentType: "image/png", width: 512, height: 300 });
    expect(validateLogo(jpeg(400, 400), "image/jpeg")).toMatchObject({ contentType: "image/jpeg", width: 400, height: 400 });
    expect(validateLogo(webpLossless(256, 128), "image/webp")).toMatchObject({ contentType: "image/webp", width: 256, height: 128 });
  });

  it("recusa SVG (mesmo declarado como PNG), HTML e arquivos desconhecidos", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(() => validateLogo(svg, "image/png")).toThrow(/SVG/);
    expect(() => validateLogo(svg, "image/svg+xml")).toThrow(/SVG/);
    expect(() => validateLogo(new TextEncoder().encode("<html><body>oi</body></html>"), "image/png")).toThrow(/Formato não reconhecido/);
    expect(() => validateLogo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(LogoValidationError);
  });

  it("recusa conteúdo que não corresponde ao tipo informado (PNG enviado como JPEG)", () => {
    expect(() => validateLogo(png(300, 300), "image/jpeg")).toThrow(/não corresponde/);
  });

  it("recusa vazio, grande demais, pequena demais e dimensões absurdas", () => {
    expect(() => validateLogo(new Uint8Array(0))).toThrow(/vazio/);
    expect(() => validateLogo(png(300, 300, LOGO_MAX_BYTES + 1))).toThrow(/grande demais/);
    expect(() => validateLogo(png(32, 32))).toThrow(/pequena demais/);
    expect(() => validateLogo(png(5000, 5000))).toThrow(/grande demais/);
    expect(() => validateLogo(png(300, 300).slice(0, 18))).toThrow(/dimensões/);
  });
});

describe("Configurações: validação dos campos", () => {
  const valid = {
    siteName: "Garage Bela", tagline: "", intro: "", phone: "", whatsapp: "(11) 90000-0000",
    address: "Rua A, 10", locationNotes: "Sala 2\nInterfone 12", instagramUrl: "@studiobela",
  };

  it("aceita dados válidos e normaliza o Instagram", () => {
    const r = siteSettingsSchema.parse(valid);
    expect(r.instagramUrl).toBe("https://www.instagram.com/studiobela");
  });

  it("normalizeInstagram aceita @, link e rejeita outros domínios e esquemas perigosos", () => {
    expect(normalizeInstagram("studio.bela_1")).toBe("https://www.instagram.com/studio.bela_1");
    expect(normalizeInstagram("https://instagram.com/studiobela/?hl=pt")).toBe("https://www.instagram.com/studiobela");
    expect(normalizeInstagram("")).toBe("");
    expect(normalizeInstagram("javascript:alert(1)")).toBeNull();
    expect(normalizeInstagram("https://evil.com/studiobela")).toBeNull();
    expect(normalizeInstagram("https://instagram.com.evil.com/x")).toBeNull();
    expect(normalizeInstagram("nome com espaço")).toBeNull();
  });

  it("recusa nome curto/vazio, telefone inválido, textos longos e caracteres de controle", () => {
    expect(siteSettingsSchema.safeParse({ ...valid, siteName: " " }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, phone: "123" }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, intro: "x".repeat(301) }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, siteName: "Garage‮Bela" }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, address: "Rua\u0000A" }).success).toBe(false);
  });

  it("whatsappLink assume Brasil e recusa números curtos", () => {
    expect(whatsappLink("(11) 90000-0000")).toBe("https://wa.me/5511900000000");
    expect(whatsappLink("+55 11 90000-0000")).toBe("https://wa.me/5511900000000");
    expect(whatsappLink("123")).toBeNull();
  });
});

describe("Configurações: persistência e padrões", () => {
  beforeEach(resetDb);

  it("sem nenhuma linha no banco (instalação anterior) usa os padrões e não mostra contatos", async () => {
    const s = await loadSiteSettings();
    expect(s).toMatchObject({ siteName: DEFAULT_SITE.name, tagline: DEFAULT_SITE.tagline, intro: DEFAULT_SITE.intro, phone: "", address: "", logoUrl: null });
  });

  it("salva, relê e troca/remove a logo incrementando a versão", async () => {
    const input = siteSettingsSchema.parse({
      siteName: "Garage Bela", tagline: "", intro: "", phone: "", whatsapp: "", address: "Rua A, 10", locationNotes: "", instagramUrl: "",
    });
    let s = await saveSiteSettings(input, { kind: "keep" });
    expect(s).toMatchObject({ siteName: "Garage Bela", tagline: DEFAULT_SITE.tagline, address: "Rua A, 10", logoUrl: null });

    s = await saveSiteSettings(input, { kind: "replace", logo: validateLogo(png(300, 300), "image/png") });
    expect(s.logoUrl).toBe("/api/logo?v=1");
    s = await saveSiteSettings(input, { kind: "replace", logo: validateLogo(jpeg(300, 300), "image/jpeg") });
    expect(s.logoUrl).toBe("/api/logo?v=2");
    expect((await prisma.siteLogo.findUnique({ where: { id: 1 } }))?.contentType).toBe("image/jpeg");

    s = await saveSiteSettings(input, { kind: "keep" });
    expect(s.logoUrl).toBe("/api/logo?v=2");
    s = await saveSiteSettings(input, { kind: "remove" });
    expect(s.logoUrl).toBeNull();
    expect(await prisma.siteLogo.count()).toBe(0);
  });

  it("remover e enviar outra logo NUNCA reutiliza um número de versão (a URL é cacheada por 1 ano)", async () => {
    const input = siteSettingsSchema.parse({
      siteName: "Garage Bela", tagline: "", intro: "", phone: "", whatsapp: "", address: "", locationNotes: "", instagramUrl: "",
    });
    let s = await saveSiteSettings(input, { kind: "replace", logo: validateLogo(png(300, 300), "image/png") });
    expect(s.logoUrl).toBe("/api/logo?v=1");
    s = await saveSiteSettings(input, { kind: "remove" });
    expect(s.logoUrl).toBeNull();
    s = await saveSiteSettings(input, { kind: "keep" });
    expect(s.logoUrl).toBeNull(); // salvar só o texto não "ressuscita" a logo
    s = await saveSiteSettings(input, { kind: "replace", logo: validateLogo(jpeg(300, 300), "image/jpeg") });
    expect(s.logoUrl).toBe("/api/logo?v=2"); // v=1 já esteve em cache de navegadores com a logo antiga
  });

  it("a rota /api/logo serve a imagem com cabeçalhos seguros, 304 por ETag e 404 sem logo", async () => {
    const { GET } = await import("@/app/api/logo/route");
    expect((await GET(new Request("http://x/api/logo"))).status).toBe(404);

    const input = siteSettingsSchema.parse({ siteName: "Garage", tagline: "", intro: "", phone: "", whatsapp: "", address: "", locationNotes: "", instagramUrl: "" });
    await saveSiteSettings(input, { kind: "replace", logo: validateLogo(png(300, 200), "image/png") });
    const res = await GET(new Request("http://x/api/logo?v=1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect((await res.arrayBuffer()).byteLength).toBe(200);

    const etag = res.headers.get("etag")!;
    const again = await GET(new Request("http://x/api/logo?v=1", { headers: { "If-None-Match": etag } }));
    expect(again.status).toBe(304);
  });
});

describe("Configurações: permissões da ação de salvar", () => {
  beforeEach(resetDb);

  async function loadActionAs(user: { id: string; role: "ADMIN" | "CLIENTE" } | null) {
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({
      requireAdmin: async () => {
        if (!user || user.role !== "ADMIN") throw new Error("NEXT_REDIRECT"); // o redirect() real também interrompe a execução
        return user;
      },
    }));
    // React 18 estável não exporta `cache` (o Next usa a versão dele); aqui basta uma função que não memoriza.
    vi.doMock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
    vi.doMock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
    return import("@/app/admin/configuracoes/actions");
  }

  const form = (extra: Record<string, string | File> = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ siteName: "Garage Nova", tagline: "", intro: "", phone: "", whatsapp: "", address: "Rua B, 20", locationNotes: "", instagramUrl: "", ...extra })) {
      fd.set(k, v);
    }
    return fd;
  };

  it("cliente (ou visitante) não consegue alterar nada; administradora consegue", async () => {
    const client = await createClient();
    const admin = await createAdmin();

    let action = await loadActionAs({ id: client.id, role: "CLIENTE" });
    await expect(action.saveSiteSettingsAction(null, form())).rejects.toThrow("NEXT_REDIRECT");
    action = await loadActionAs(null);
    await expect(action.saveSiteSettingsAction(null, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(await prisma.siteSettings.count()).toBe(0);

    action = await loadActionAs({ id: admin.id, role: "ADMIN" });
    const ok = await action.saveSiteSettingsAction(null, form());
    expect(ok).toMatchObject({ ok: true });
    expect((await loadSiteSettings()).siteName).toBe("Garage Nova");
  });

  it("upload: aceita imagem válida; recusa SVG disfarçado, tipo trocado e arquivo grande, sem alterar nada", async () => {
    const admin = await createAdmin();
    const action = await loadActionAs({ id: admin.id, role: "ADMIN" });
    const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes as BlobPart], name, { type });

    const okRes = await action.saveSiteSettingsAction(null, form({ logo: file(png(300, 300), "logo.png", "image/png") }));
    expect(okRes).toMatchObject({ ok: true });
    expect((await loadSiteSettings()).logoUrl).toBe("/api/logo?v=1");

    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>");
    for (const bad of [
      file(svg, "logo.png", "image/png"),
      file(png(300, 300), "logo.jpg", "image/jpeg"),
      file(png(300, 300, LOGO_MAX_BYTES + 10), "grande.png", "image/png"),
    ]) {
      const res = await action.saveSiteSettingsAction(null, form({ siteName: "Mudou?", logo: bad }));
      expect(res?.ok).toBe(false);
      expect(res?.errors?.logo).toBeTruthy();
    }
    // Nada mudou: nem a logo, nem o nome (a gravação é tudo-ou-nada).
    const s = await loadSiteSettings();
    expect(s.logoUrl).toBe("/api/logo?v=1");
    expect(s.siteName).toBe("Garage Nova");
  });
});
