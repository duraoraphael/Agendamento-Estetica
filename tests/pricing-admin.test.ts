import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, createAdmin, createClient, createService, setPricing, setServicePrices } from "./helpers";
import { prisma } from "@/lib/db";
import { upsertServiceAction } from "@/app/admin/servicos/actions";
import { togglePriceByTypeAction } from "@/app/admin/configuracoes/preco-actions";
import { loadPriceByTypeEnabled, loadPriceTables } from "@/lib/pricing-data";

// ---- Sessão simulada (o banco e o limitador são REAIS) ----
let session: { id: string; role: "ADMIN" | "CLIENTE" | null } = { id: "", role: null };
vi.mock("@/lib/session", () => {
  const deny = (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  };
  return {
    requireAdmin: async () => (session.role === "ADMIN" ? { id: session.id, role: "ADMIN", name: "Admin" } : deny("/login")),
    requireClient: async () => (session.role === "CLIENTE" ? { id: session.id, role: "CLIENTE", name: "Cliente" } : deny("/login")),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const toggleForm = (on: boolean) => {
  const fd = new FormData();
  if (on) fd.set("priceByVehicleType", "on");
  return fd;
};

const serviceForm = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: "Polimento", priceReais: "50,00", durationMinutes: "60", active: "on", ...fields })) fd.set(k, v);
  return fd;
};

beforeEach(async () => {
  await resetDb();
  session = { id: "", role: null };
});

describe("Chave 'Cobrar por tipo de veículo' (Configurações)", () => {
  it("visitante e cliente não conseguem alterar; nada muda no banco", async () => {
    await expect(togglePriceByTypeAction(null, toggleForm(true))).rejects.toThrow(/REDIRECT:/);
    const client = await createClient();
    session = { id: client.id, role: "CLIENTE" };
    await expect(togglePriceByTypeAction(null, toggleForm(true))).rejects.toThrow(/REDIRECT:/);
    expect(await loadPriceByTypeEnabled()).toBe(false);
    expect(await prisma.siteSettings.count()).toBe(0);
  });

  it("administradora liga e desliga; ao desligar, os preços por categoria continuam guardados", async () => {
    const admin = await createAdmin();
    session = { id: admin.id, role: "ADMIN" };
    const service = await createService();
    await setServicePrices(service.id, { SUV: 9000, HATCH: 4000 });

    expect(await togglePriceByTypeAction(null, toggleForm(true))).toMatchObject({ ok: true });
    expect(await loadPriceByTypeEnabled()).toBe(true);

    expect(await togglePriceByTypeAction(null, toggleForm(false))).toMatchObject({ ok: true });
    expect(await loadPriceByTypeEnabled()).toBe(false);
    expect((await loadPriceTables([service.id])).get(service.id)).toEqual({ SUV: 9000, HATCH: 4000 });
  });
});

describe("Preços por tipo de veículo no cadastro do serviço", () => {
  it("cria o serviço com as categorias preenchidas (vírgula decimal) e ignora as vazias", async () => {
    const admin = await createAdmin();
    session = { id: admin.id, role: "ADMIN" };
    const result = await upsertServiceAction(null, serviceForm({ price_SUV: "90,00", price_HATCH: "40", price_SEDA: "" }));
    const service = await prisma.service.findFirstOrThrow({ where: { name: "Polimento" } });
    expect(result).toEqual({ errors: {}, createdId: service.id });
    expect((await loadPriceTables([service.id])).get(service.id)).toEqual({ SUV: 9000, HATCH: 4000 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "service_prices_updated" } });
    expect(log).toMatchObject({ actorId: admin.id, targetId: service.id, detail: "2 categorias" });
    expect(log.detail).not.toMatch(/90|9000/); // nenhum valor no registro
  });

  it("preço de categoria inválido: erro no campo, e NADA é gravado (nem o serviço, nem as outras categorias)", async () => {
    const admin = await createAdmin();
    session = { id: admin.id, role: "ADMIN" };
    const result = await upsertServiceAction(null, serviceForm({ price_SUV: "abc", price_HATCH: "40" }));
    expect(result).toEqual({ errors: { price_SUV: "Informe um preço válido, ex: 90,00." } });
    expect(await prisma.service.count()).toBe(0);
    expect(await prisma.servicePrice.count()).toBe(0);
  });

  it("editar: preço inválido não altera o serviço; campo esvaziado apaga só aquela categoria", async () => {
    const admin = await createAdmin();
    session = { id: admin.id, role: "ADMIN" };
    const service = await createService({ name: "Polimento", priceCents: 5000 });
    await setServicePrices(service.id, { SUV: 9000, HATCH: 4000 });

    const bad = await upsertServiceAction(null, serviceForm({ id: service.id, name: "Renomeado", price_SUV: "-5" }));
    expect(bad).toMatchObject({ errors: { price_SUV: expect.any(String) } });
    expect((await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).name).toBe("Polimento");
    expect((await loadPriceTables([service.id])).get(service.id)).toEqual({ SUV: 9000, HATCH: 4000 });

    await expect(upsertServiceAction(null, serviceForm({ id: service.id, name: "Renomeado", price_SUV: "95,50", price_HATCH: "" }))).rejects.toThrow(/REDIRECT:\/admin\/servicos/);
    expect((await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).name).toBe("Renomeado");
    expect((await loadPriceTables([service.id])).get(service.id)).toEqual({ SUV: 9550 });
  });

  it("cliente não consegue salvar preços (a ação é um endpoint público: o papel é conferido no servidor)", async () => {
    const client = await createClient();
    session = { id: client.id, role: "CLIENTE" };
    await expect(upsertServiceAction(null, serviceForm({ price_SUV: "1,00" }))).rejects.toThrow(/REDIRECT:/);
    expect(await prisma.service.count()).toBe(0);
    expect(await prisma.servicePrice.count()).toBe(0);
  });

  it("a chave ligada não muda o que a ação grava (os preços ficam guardados mesmo desligada)", async () => {
    const admin = await createAdmin();
    session = { id: admin.id, role: "ADMIN" };
    await setPricing({ enabled: false });
    await upsertServiceAction(null, serviceForm({ price_VAN: "120,00" }));
    const service = await prisma.service.findFirstOrThrow({ where: { name: "Polimento" } });
    expect((await loadPriceTables([service.id])).get(service.id)).toEqual({ VAN: 12_000 });
  });
});
