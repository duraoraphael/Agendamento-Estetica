import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resetDb, openAllWeek, createAdmin, createClient, createService, createBooking, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/admin/servicos/[id]/fotos/route";
import { deleteServiceAction } from "@/app/admin/servicos/actions";
import { removeServiceImageAction, reorderServiceImagesAction, updateServiceImageAltAction } from "@/app/admin/servicos/fotos-actions";
import { addServiceImage, getServiceCovers, getServiceGalleries, listServicePhotos, processStorageCleanup, removeServiceImage, ServiceImagesError } from "@/lib/service-images";
import { processServiceImage, ServiceImageError } from "@/lib/image-processing";
import { setStorageForTests, StorageError, type StorageAdapter, isValidServiceObjectPath } from "@/lib/storage";
import { SERVICE_IMAGE_MAX_UPLOAD_BYTES, serviceImageAlt } from "@/lib/service-image-config";
import { ServiceImageView } from "@/components/ServiceImageView";
import { RATE_LIMITS } from "@/lib/constants";

// ---- Sessão simulada (o banco, o limitador e o log são REAIS; o Storage é um falso em memória) ----
let session: { id: string; role: "ADMIN" | "CLIENTE" | null } = { id: "", role: null };
vi.mock("@/lib/session", () => {
  const deny = (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  };
  return {
    requireAdmin: async () => (session.role === "ADMIN" ? { id: session.id, role: "ADMIN", name: "Admin" } : deny("/login")),
    requireClient: async () => (session.role === "CLIENTE" ? { id: session.id, role: "CLIENTE", name: "Cliente" } : deny("/login")),
    getAdminApiUser: async () => (session.role === "ADMIN" ? { id: session.id } : null),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

class MemoryStorage implements StorageAdapter {
  objects = new Map<string, number>();
  failUpload = false;
  failRemove = false;
  async upload(objectPath: string, bytes: Uint8Array) {
    if (this.failUpload) throw new StorageError("STORAGE");
    if (this.objects.has(objectPath)) throw new StorageError("STORAGE"); // nunca sobrescreve
    this.objects.set(objectPath, bytes.byteLength);
  }
  async remove(objectPath: string) {
    if (this.failRemove) throw new StorageError("STORAGE");
    this.objects.delete(objectPath);
  }
}
let storage: MemoryStorage;

async function jpeg(width = 800, height = 600, extra?: (s: sharp.Sharp) => sharp.Sharp) {
  const base = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg();
  return (extra ? extra(base) : base).toBuffer();
}
const png = (w = 300, h = 200) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();

function upload(serviceId: string, body: Uint8Array | Buffer, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://localhost/api/admin/servicos/${serviceId}/fotos`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", ...headers },
      body: body as BodyInit,
    }),
    { params: Promise.resolve({ id: serviceId }) },
  );
}
const asAdmin = (id: string) => (session = { id, role: "ADMIN" });

beforeAll(() => {
  process.env.SUPABASE_URL = "https://abcdefgh.supabase.co";
});
afterAll(() => setStorageForTests(null));

beforeEach(async () => {
  await resetDb();
  session = { id: "", role: null };
  storage = new MemoryStorage();
  setStorageForTests(storage);
  vi.restoreAllMocks();
});

describe("Quem pode enviar, reordenar e remover", () => {
  it("só ADMIN envia: administradora recebe 201; cliente e visitante recebem 401 e nada é gravado", async () => {
    const admin = await createAdmin();
    const client = await createClient();
    const service = await createService();
    const img = await jpeg();

    session = { id: client.id, role: "CLIENTE" };
    expect((await upload(service.id, img)).status).toBe(401);
    session = { id: "", role: null };
    expect((await upload(service.id, img)).status).toBe(401);
    expect(await prisma.serviceImage.count()).toBe(0);
    expect(storage.objects.size).toBe(0);

    asAdmin(admin.id);
    const ok = await upload(service.id, img);
    expect(ok.status).toBe(201);
    expect(await prisma.serviceImage.count()).toBe(1);
    expect(storage.objects.size).toBe(1);
  });

  it("cliente e visitante não reordenam, não removem e não editam o texto alternativo", async () => {
    const admin = await createAdmin();
    const client = await createClient();
    const service = await createService();
    asAdmin(admin.id);
    await upload(service.id, await jpeg());
    await upload(service.id, await jpeg());
    const before = await prisma.serviceImage.findMany({ where: { serviceId: service.id }, orderBy: { position: "asc" } });

    for (const who of [{ id: client.id, role: "CLIENTE" as const }, { id: "", role: null }]) {
      session = who;
      await expect(reorderServiceImagesAction(service.id, [before[1].id, before[0].id])).rejects.toThrow(/REDIRECT:/);
      await expect(removeServiceImageAction(service.id, before[0].id)).rejects.toThrow(/REDIRECT:/);
      await expect(updateServiceImageAltAction(service.id, before[0].id, "x")).rejects.toThrow(/REDIRECT:/);
    }
    const after = await prisma.serviceImage.findMany({ where: { serviceId: service.id }, orderBy: { position: "asc" } });
    expect(after.map((a) => [a.id, a.position, a.altText])).toEqual(before.map((a) => [a.id, a.position, a.altText]));
    expect(storage.objects.size).toBe(2);
  });

  it("pedido de outro site (Origin diferente / Sec-Fetch-Site cross-site) é recusado com 403", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    const img = await jpeg();
    expect((await upload(service.id, img, { origin: "https://site-malicioso.example" })).status).toBe(403);
    expect((await upload(service.id, img, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await upload(service.id, img, { origin: "http://localhost", "sec-fetch-site": "same-origin" })).status).toBe(201);
  });

  it("serviço inexistente: 404, sem criar nada", async () => {
    const admin = await createAdmin();
    asAdmin(admin.id);
    const img = await jpeg();
    expect((await upload("nao-existe-123", img)).status).toBe(404);
    expect(storage.objects.size).toBe(0);
  });

  it("limite de envios por minuto da administradora", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    const bad = Buffer.from("isto não é uma imagem");
    let last = 0;
    for (let i = 0; i < RATE_LIMITS.serviceImageWritesPerMinute + 1; i++) last = (await upload(service.id, bad)).status;
    expect(last).toBe(429);
  });
});

describe("Arquivos inválidos e grandes", () => {
  it.each([
    ["texto com extensão de imagem", Buffer.from("<html><script>alert(1)</script></html>")],
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["GIF", Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(40)])],
    ["executável (MZ)", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)])],
    ["PDF", Buffer.from("%PDF-1.7\n" + "x".repeat(100))],
  ])("recusa %s pelos bytes, não pela extensão", async (_name, bytes) => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    const res = await upload(service.id, bytes);
    expect(res.status).toBe(415);
    expect(await prisma.serviceImage.count()).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it("recusa JPEG corrompido/truncado (cabeçalho válido, dados cortados)", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    const full = await jpeg(1200, 900, (s) => s.jpeg({ quality: 90 }));
    const res = await upload(service.id, full.subarray(0, Math.floor(full.length / 3)));
    expect([415, 422]).toContain(res.status);
    expect(storage.objects.size).toBe(0);
  });

  it("recusa arquivo vazio (400) e arquivo acima de 8 MB (413), sem ler o resto", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    expect((await upload(service.id, Buffer.alloc(0))).status).toBe(400);
    const big = Buffer.alloc(SERVICE_IMAGE_MAX_UPLOAD_BYTES + 1, 1);
    expect((await upload(service.id, big)).status).toBe(413);
    // O tamanho declarado já basta para recusar.
    const declared = await POST(
      new Request(`http://localhost/api/admin/servicos/${service.id}/fotos`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "content-length": String(SERVICE_IMAGE_MAX_UPLOAD_BYTES + 1) },
        body: Buffer.from("x"),
      }),
      { params: Promise.resolve({ id: service.id }) },
    );
    expect(declared.status).toBe(413);
    await expect(processServiceImage(big)).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(storage.objects.size).toBe(0);
  });

  it("recusa imagem animada", async () => {
    // WebP animado de verdade: 3 quadros de 40 × 40 empilhados, com `pageHeight`.
    const raw = Buffer.alloc(40 * 40 * 3 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) % 255;
    const animated = await sharp(raw, { raw: { width: 40, height: 120, channels: 3, pageHeight: 40 } }).webp({ loop: 0, delay: [100, 100, 100] }).toBuffer();
    expect(animated.includes(Buffer.from("ANIM"))).toBe(true);
    await expect(processServiceImage(animated)).rejects.toMatchObject({ code: "ANIMATED" });
  });

  it("o Content-Type enviado não engana: um PNG de verdade é aceito com qualquer tipo; um texto com image/jpeg não", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    expect((await upload(service.id, await png(), { "content-type": "text/plain" })).status).toBe(201);
    expect((await upload(service.id, Buffer.from("texto"), { "content-type": "image/jpeg" })).status).toBe(415);
  });
});

describe("Processamento: WebP, 1600 × 1200, sem metadados", () => {
  it("converte para WebP, mantém a proporção, corrige a orientação e remove EXIF", async () => {
    // 2400 × 1800 com orientação EXIF 6 (girar 90°) e um texto "secreto" no EXIF.
    const original = await jpeg(2400, 1800, (s) => s.withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "SEGREDO-DO-EXIF-123" } } }));
    expect((await sharp(original).metadata()).exif).toBeDefined();
    expect(original.includes(Buffer.from("SEGREDO-DO-EXIF-123"))).toBe(true);

    const out = await processServiceImage(original);
    expect(out.contentType).toBe("image/webp");
    expect(out.width).toBeLessThanOrEqual(1600);
    expect(out.height).toBeLessThanOrEqual(1200);
    // Orientação aplicada: 1800 × 2400 em pé -> cabe em 1600 × 1200 como 900 × 1200 (proporção 3:4 mantida).
    expect(out.width).toBe(900);
    expect(out.height).toBe(1200);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.bytes.includes(Buffer.from("SEGREDO-DO-EXIF-123"))).toBe(false);
    expect(out.sizeBytes).toBe(out.bytes.length);
    expect({ w: meta.width, h: meta.height }).toEqual({ w: out.width, h: out.height });
  });

  it("não amplia imagem pequena; dimensões e tamanho gravados vêm do servidor", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    const res = await upload(service.id, await png(320, 200));
    expect(res.status).toBe(201);
    const row = await prisma.serviceImage.findFirstOrThrow({ where: { serviceId: service.id } });
    expect([row.width, row.height, row.contentType]).toEqual([320, 200, "image/webp"]);
    expect(row.sizeBytes).toBe(storage.objects.get(row.objectPath));
    expect(isValidServiceObjectPath(row.objectPath)).toBe(true);
    expect(row.objectPath).toMatch(new RegExp(`^services/${service.id}/[0-9a-f-]{36}\\.webp$`));
  });

  it("o nome do caminho é aleatório: nada do arquivo original entra", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    await upload(service.id, await jpeg());
    await upload(service.id, await jpeg());
    const paths = (await prisma.serviceImage.findMany()).map((r) => r.objectPath);
    expect(new Set(paths).size).toBe(2);
    for (const p of paths) expect(p).not.toMatch(/\.\.|%|\\|foto|jpg|jpeg|png/i);
  });
});

describe("Limite de 6 fotos", () => {
  it("com 10 envios simultâneos, só 6 entram; as outras 4 recebem 409 e não deixam arquivo órfão", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    const imgs = await Promise.all(Array.from({ length: 10 }, (_, i) => jpeg(400 + i, 300)));
    const results = await Promise.all(imgs.map((img) => upload(service.id, img)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(6);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    const rows = await prisma.serviceImage.findMany({ where: { serviceId: service.id }, orderBy: { position: "asc" } });
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(storage.objects.size).toBe(6);
    expect([...storage.objects.keys()].sort()).toEqual(rows.map((r) => r.objectPath).sort());
  });

  it("o 7º envio sequencial também é recusado", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    for (let i = 0; i < 6; i++) expect((await upload(service.id, await jpeg())).status).toBe(201);
    const res = await upload(service.id, await jpeg());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("LIMIT");
  });

  it("o limite é por serviço", async () => {
    const admin = await createAdmin();
    const a = await createService({ name: "A" });
    const b = await createService({ name: "B" });
    asAdmin(admin.id);
    for (let i = 0; i < 6; i++) await upload(a.id, await jpeg());
    expect((await upload(b.id, await jpeg())).status).toBe(201);
  });
});

describe("Capa, ordem e remoção", () => {
  async function seed(n: number) {
    const admin = await createAdmin();
    const service = await createService({ name: "Lavagem detalhada" });
    asAdmin(admin.id);
    for (let i = 0; i < n; i++) await upload(service.id, await jpeg(400 + i * 10, 300));
    const rows = await prisma.serviceImage.findMany({ where: { serviceId: service.id }, orderBy: { position: "asc" } });
    return { admin, service, rows };
  }

  it("a primeira foto enviada é a capa; a galeria vem na ordem", async () => {
    const { service, rows } = await seed(3);
    const covers = await getServiceCovers([service]);
    expect(covers.get(service.id)?.id).toBe(rows[0].id);
    const gallery = (await getServiceGalleries([service])).get(service.id) ?? [];
    expect(gallery.map((g) => g.id)).toEqual(rows.map((r) => r.id));
    expect(gallery[0].url).toBe(`https://abcdefgh.supabase.co/storage/v1/object/public/service-images/${rows[0].objectPath}`);
  });

  it("reordenar muda a capa", async () => {
    const { service, rows } = await seed(3);
    expect((await reorderServiceImagesAction(service.id, [rows[2].id, rows[0].id, rows[1].id])).ok).toBe(true);
    const after = await prisma.serviceImage.findMany({ where: { serviceId: service.id }, orderBy: { position: "asc" } });
    expect(after.map((r) => r.id)).toEqual([rows[2].id, rows[0].id, rows[1].id]);
    expect((await getServiceCovers([service])).get(service.id)?.id).toBe(rows[2].id);
    expect(await prisma.auditLog.count({ where: { action: "service_image_reordered" } })).toBe(1);
  });

  it("reordenar recusa lista incompleta, repetida ou com foto de outro serviço", async () => {
    const { service, rows } = await seed(3);
    const other = await createService({ name: "Outro" });
    await upload(other.id, await jpeg());
    const foreign = await prisma.serviceImage.findFirstOrThrow({ where: { serviceId: other.id } });
    for (const ids of [[rows[0].id, rows[1].id], [rows[0].id, rows[0].id, rows[1].id], [rows[0].id, rows[1].id, foreign.id]]) {
      const res = await reorderServiceImagesAction(service.id, ids);
      expect(res.ok).toBe(false);
    }
    const unchanged = await prisma.serviceImage.findMany({ where: { serviceId: service.id }, orderBy: { position: "asc" } });
    expect(unchanged.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it("remover a capa promove a próxima foto e fecha o buraco nas posições; o arquivo sai do Storage", async () => {
    const { service, rows } = await seed(3);
    const res = await removeServiceImageAction(service.id, rows[0].id);
    expect(res.ok).toBe(true);
    const left = await prisma.serviceImage.findMany({ where: { serviceId: service.id }, orderBy: { position: "asc" } });
    expect(left.map((r) => [r.id, r.position])).toEqual([[rows[1].id, 0], [rows[2].id, 1]]);
    expect((await getServiceCovers([service])).get(service.id)?.id).toBe(rows[1].id);
    expect(storage.objects.has(rows[0].objectPath)).toBe(false);
    expect(storage.objects.size).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "service_image_removed" } })).toBe(1);
  });

  it("remover a única foto deixa o serviço sem capa (cai no placeholder)", async () => {
    const { service, rows } = await seed(1);
    expect((await removeServiceImageAction(service.id, rows[0].id)).ok).toBe(true);
    expect((await getServiceCovers([service])).has(service.id)).toBe(false);
    expect(await listServicePhotos(service.id, service.name)).toEqual([]);
  });

  it("uma foto não pode ser removida pelo ID de OUTRO serviço", async () => {
    const { service, rows } = await seed(2);
    const other = await createService({ name: "Outro" });
    const res = await removeServiceImageAction(other.id, rows[0].id);
    expect(res.ok).toBe(false);
    expect(await prisma.serviceImage.count({ where: { serviceId: service.id } })).toBe(2);
    expect(storage.objects.has(rows[0].objectPath)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "service_image_removed" } })).toBe(0);
    await expect(removeServiceImage({ serviceId: other.id, imageId: rows[0].id, adminId: session.id })).rejects.toBeInstanceOf(ServiceImagesError);
  });

  it("texto alternativo: salva, usa o padrão quando vazio e recusa texto longo ou de outro serviço", async () => {
    const { service, rows } = await seed(1);
    expect((await updateServiceImageAltAction(service.id, rows[0].id, "  Carro preto sendo lavado  ")).ok).toBe(true);
    expect((await listServicePhotos(service.id, service.name))[0].alt).toBe("Carro preto sendo lavado");
    expect((await updateServiceImageAltAction(service.id, rows[0].id, "")).ok).toBe(true);
    expect((await listServicePhotos(service.id, service.name))[0].alt).toBe("Lavagem detalhada — Garage Zero Zero");
    expect((await updateServiceImageAltAction(service.id, rows[0].id, "x".repeat(161))).ok).toBe(false);
    const other = await createService({ name: "Outro" });
    expect((await updateServiceImageAltAction(other.id, rows[0].id, "invasão")).ok).toBe(false);
    expect(serviceImageAlt("", "Polimento técnico")).toBe("Polimento técnico — Garage Zero Zero");
    expect(serviceImageAlt("   ", "Polimento técnico")).not.toMatch(/imagem|foto de/i);
  });
});

describe("Falhas: nada de arquivo órfão nem metadado apontando para o vazio", () => {
  it("falha ao gravar no banco depois do envio: o arquivo recém-enviado é apagado", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("banco fora do ar"));
    const res = await upload(service.id, await jpeg());
    expect(res.status).toBe(500);
    expect(await prisma.serviceImage.count()).toBe(0);
    expect(storage.objects.size).toBe(0);
    expect(await prisma.storageCleanup.count()).toBe(0);
  });

  it("falha no banco E no Storage: o caminho vai para a fila de limpeza (e a limpeza depois resolve)", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    storage.failRemove = true;
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("banco fora do ar"));
    const res = await upload(service.id, await jpeg());
    expect(res.status).toBe(500);
    expect(storage.objects.size).toBe(1);
    expect(await prisma.storageCleanup.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "service_image_cleanup_pending", result: "FALHA" } })).toBe(1);

    // Ainda indisponível: continua pendente.
    expect(await processStorageCleanup()).toEqual({ removed: 0, failed: 1 });
    storage.failRemove = false;
    expect(await processStorageCleanup()).toEqual({ removed: 1, failed: 0 });
    expect(storage.objects.size).toBe(0);
    expect(await prisma.storageCleanup.count()).toBe(0);
  });

  it("Storage recusa o envio: nenhum metadado é gravado (502)", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    storage.failUpload = true;
    const res = await upload(service.id, await jpeg());
    expect(res.status).toBe(502);
    expect(await prisma.serviceImage.count()).toBe(0);
  });

  it("Storage fora do ar na REMOÇÃO: o metadado sai (a vitrine não aponta para ela) e o arquivo vai para a limpeza", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    await upload(service.id, await jpeg());
    const row = await prisma.serviceImage.findFirstOrThrow();
    storage.failRemove = true;
    const out = await removeServiceImageAction(service.id, row.id);
    expect(out.ok).toBe(true);
    expect(await prisma.serviceImage.count()).toBe(0);
    expect((await getServiceCovers([service])).has(service.id)).toBe(false);
    expect((await prisma.storageCleanup.findFirstOrThrow()).objectPath).toBe(row.objectPath);
  });

  it("Storage não configurado (sem chave e sem adaptador): 503 claro, nada gravado", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    setStorageForTests(null);
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const res = await upload(service.id, await jpeg());
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("STORAGE_NOT_CONFIGURED");
    } finally {
      if (key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
      setStorageForTests(storage);
    }
    expect(await prisma.serviceImage.count()).toBe(0);
  });
});

describe("Auditoria sem dados sensíveis", () => {
  it("registra envio, ordem e remoção só com IDs e textos curtos (sem caminho, URL ou bytes)", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    await upload(service.id, await jpeg());
    await upload(service.id, await jpeg());
    const rows = await prisma.serviceImage.findMany({ orderBy: { position: "asc" } });
    await reorderServiceImagesAction(service.id, [rows[1].id, rows[0].id]);
    await removeServiceImageAction(service.id, rows[0].id);
    const logs = await prisma.auditLog.findMany({ where: { action: { startsWith: "service_image_" } } });
    expect(logs.map((l) => l.action).sort()).toEqual(["service_image_added", "service_image_added", "service_image_removed", "service_image_reordered"]);
    const dump = JSON.stringify(logs);
    for (const r of rows) expect(dump).not.toContain(r.objectPath);
    expect(dump).not.toMatch(/supabase|https?:\/\/|\.webp|\.jpe?g|service_role/i);
    for (const l of logs) expect(l.actorId).toBe(admin.id);
  });
});

describe("Vitrine: placeholder e fotos", () => {
  const fallback = { src: "/images/lavagem-detalhada.webp", width: 1200, height: 800, alt: "Placeholder Garage Zero Zero" };

  it("serviço sem foto usa o placeholder", () => {
    const html = renderToStaticMarkup(createElement(ServiceImageView, { photo: null, fallback, sizes: "100vw" }));
    expect(html).toContain("lavagem-detalhada.webp");
    expect(html).toContain('data-placeholder="true"');
    expect(html).toContain('alt="Placeholder Garage Zero Zero"');
  });

  it("serviço com foto usa a foto (alt descritivo, dimensões conhecidas, sizes e lazy por padrão)", () => {
    const photo = { url: "https://abcdefgh.supabase.co/storage/v1/object/public/service-images/services/x/00000000-0000-4000-8000-000000000000.webp", alt: "Lavagem detalhada — Garage Zero Zero", width: 1600, height: 1067 };
    const html = renderToStaticMarkup(createElement(ServiceImageView, { photo, fallback, sizes: "(min-width: 768px) 33vw, 100vw" }));
    expect(html).not.toContain('data-placeholder="true"');
    expect(html).toContain("abcdefgh.supabase.co");
    expect(html).toContain('alt="Lavagem detalhada — Garage Zero Zero"');
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="1067"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('sizes="(min-width: 768px) 33vw, 100vw"');
    expect(html).not.toMatch(/alt="(imagem|foto de)/i);
  });

  it("priority só quando pedido (sem lazy) e a decorativa tem alt vazio", () => {
    const photo = { url: "https://abcdefgh.supabase.co/storage/v1/object/public/service-images/services/x/00000000-0000-4000-8000-000000000000.webp", alt: "x", width: 800, height: 600 };
    const html = renderToStaticMarkup(createElement(ServiceImageView, { photo, fallback, sizes: "100vw", priority: true, decorative: true }));
    expect(html).not.toContain('loading="lazy"');
    expect(html).toContain('alt=""');
  });
});

describe("Excluir serviço", () => {
  it("serviço sem reservas é excluído com as fotos (banco e Storage) e fica registrado na auditoria", async () => {
    const admin = await createAdmin();
    const alvo = await createService({ name: "Serviço para excluir" });
    const outro = await createService({ name: "Serviço que fica" });
    asAdmin(admin.id);
    await upload(alvo.id, await jpeg());
    await upload(alvo.id, await jpeg());
    await upload(outro.id, await jpeg());
    expect(storage.objects.size).toBe(3);

    expect(await deleteServiceAction(alvo.id)).toEqual({ ok: true });
    expect(await prisma.service.findUnique({ where: { id: alvo.id } })).toBeNull();
    expect(await prisma.serviceImage.count({ where: { serviceId: alvo.id } })).toBe(0);
    // Só as fotos do outro serviço continuam, no banco e no Storage.
    expect(await prisma.serviceImage.count({ where: { serviceId: outro.id } })).toBe(1);
    expect(storage.objects.size).toBe(1);
    expect(await prisma.service.findUnique({ where: { id: outro.id } })).not.toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { action: "service_deleted" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorId).toBe(admin.id);
    expect(logs[0].targetId).toBe(alvo.id);
    expect(logs[0].detail).toContain("2 foto(s)");
    expect(JSON.stringify(logs)).not.toMatch(/\.webp|supabase/i);
  });

  it("serviço com reservas NÃO é excluído (histórico e faturamento preservados) e a mensagem manda desativar", async () => {
    await openAllWeek();
    const admin = await createAdmin();
    const client = await createClient();
    const service = await createService({ name: "Com histórico" });
    await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0, 2) });
    asAdmin(admin.id);
    await upload(service.id, await jpeg());

    const res = await deleteServiceAction(service.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/1 agendamento.*Desativar/s);
    expect(await prisma.service.findUnique({ where: { id: service.id } })).not.toBeNull();
    expect(await prisma.serviceImage.count({ where: { serviceId: service.id } })).toBe(1);
    expect(storage.objects.size).toBe(1);
    expect(await prisma.appointment.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "service_deleted" } })).toBe(0);
  });

  it("cliente e visitante não excluem; ID inválido ou inexistente é recusado", async () => {
    const admin = await createAdmin();
    const client = await createClient();
    const service = await createService();
    for (const who of [{ id: client.id, role: "CLIENTE" as const }, { id: "", role: null }]) {
      session = who;
      await expect(deleteServiceAction(service.id)).rejects.toThrow(/REDIRECT:/);
    }
    expect(await prisma.service.count()).toBe(1);

    asAdmin(admin.id);
    expect((await deleteServiceAction("")).ok).toBe(false);
    expect((await deleteServiceAction("nao-existe-123")).ok).toBe(false);
    expect(await prisma.service.count()).toBe(1);
  });

  it("Storage fora do ar na exclusão: o serviço some e os arquivos vão para a fila de limpeza", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    await upload(service.id, await jpeg());
    await upload(service.id, await jpeg());
    storage.failRemove = true;
    expect(await deleteServiceAction(service.id)).toEqual({ ok: true });
    expect(await prisma.service.count()).toBe(0);
    expect(await prisma.storageCleanup.count()).toBe(2);
    storage.failRemove = false;
    expect(await processStorageCleanup()).toEqual({ removed: 2, failed: 0 });
    expect(storage.objects.size).toBe(0);
  });

  it("excluir enquanto alguém agenda: ou a reserva existe e o serviço fica, ou o serviço some e a reserva falha (nunca reserva órfã)", async () => {
    await openAllWeek();
    const admin = await createAdmin();
    const client = await createClient();
    asAdmin(admin.id);
    for (let i = 0; i < 4; i++) {
      const service = await createService({ name: `Corrida ${i}` });
      const [deleted, booking] = await Promise.allSettled([
        deleteServiceAction(service.id),
        createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(9 + i, 0, 3) }),
      ]);
      const gone = (await prisma.service.findUnique({ where: { id: service.id } })) === null;
      const bookings = await prisma.appointment.count({ where: { serviceId: service.id } });
      if (gone) expect(bookings).toBe(0);
      else expect(bookings).toBe(1);
      // Reserva criada => exclusão recusada; serviço excluído => reserva falhou. Os dois ao mesmo tempo, nunca.
      expect(booking.status === "fulfilled").toBe(!gone);
      expect(deleted.status).toBe("fulfilled");
    }
  });
});

describe("Serviços e agendamentos existentes", () => {
  it("fotos não alteram serviço nem agendamentos; serviço sem foto continua funcionando", async () => {
    await openAllWeek();
    const admin = await createAdmin();
    const client = await createClient();
    const service = await createService({ name: "Polimento técnico", priceCents: 45000, durationMinutes: 60 });
    const booking = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0, 2) });
    const serviceBefore = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });
    const bookingBefore = await prisma.appointment.findUniqueOrThrow({ where: { id: booking.id } });

    asAdmin(admin.id);
    await upload(service.id, await jpeg());
    await upload(service.id, await jpeg());
    const [first] = await prisma.serviceImage.findMany({ orderBy: { position: "asc" } });
    await removeServiceImageAction(service.id, first.id);

    expect(await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).toEqual(serviceBefore);
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: booking.id } })).toEqual(bookingBefore);

    const semFoto = await createService({ name: "Sem foto" });
    expect((await getServiceCovers([semFoto, service])).has(semFoto.id)).toBe(false);
    expect(await addServiceImage({ serviceId: semFoto.id, adminId: admin.id, processed: await processServiceImage(await jpeg()) })).toMatchObject({ position: 0 });
  });

  it("serviço sem reservas apagado leva as fotos junto (cascata do banco)", async () => {
    const admin = await createAdmin();
    const service = await createService();
    asAdmin(admin.id);
    await upload(service.id, await jpeg());
    expect(await prisma.serviceImage.count()).toBe(1);
    await prisma.service.delete({ where: { id: service.id } });
    expect(await prisma.serviceImage.count()).toBe(0);
  });

  it("serviço com reservas não é apagado: as fotos e as reservas continuam", async () => {
    await openAllWeek();
    const admin = await createAdmin();
    const client = await createClient();
    const service = await createService();
    await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(11, 0, 2) });
    asAdmin(admin.id);
    await upload(service.id, await jpeg());
    expect(await prisma.serviceImage.count()).toBe(1);
    // A reserva guarda o serviço (histórico): o banco recusa apagar o serviço com reservas. Nenhuma foto some sozinha.
    await expect(prisma.service.delete({ where: { id: service.id } })).rejects.toBeDefined();
    expect(await prisma.serviceImage.count()).toBe(1);
    expect(await prisma.appointment.count()).toBe(1);
  });

  it("migração ainda não aplicada (tabela ServiceImage inexistente, P2021): a vitrine cai nos placeholders em vez de dar 500; outros erros continuam propagando", async () => {
    const service = await createService({ name: "Lavagem detalhada" });
    const missing = Object.assign(new Error("The table `public.ServiceImage` does not exist"), { code: "P2021" });
    const spy = vi.spyOn(prisma.serviceImage, "findMany").mockRejectedValue(missing);
    expect((await getServiceCovers([service])).size).toBe(0);
    expect((await getServiceGalleries([service])).size).toBe(0);
    expect(await listServicePhotos(service.id, service.name)).toEqual([]);

    spy.mockRejectedValue(Object.assign(new Error("conexão perdida"), { code: "P1001" }));
    await expect(getServiceCovers([service])).rejects.toThrow("conexão perdida");
  });

  it("os erros carregam só um código (sem mensagem do sharp nem do banco)", async () => {
    await expect(processServiceImage(Buffer.from("lixo lixo lixo lixo lixo"))).rejects.toBeInstanceOf(ServiceImageError);
    await expect(processServiceImage(Buffer.from("lixo lixo lixo lixo lixo"))).rejects.toMatchObject({ message: "UNSUPPORTED", code: "UNSUPPORTED" });
  });
});
