import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { migrateManicureServices } from "@/lib/service-migration";
import { DEFAULT_SERVICES, LEGACY_DEMO_SERVICE_NAMES, LEGACY_SITE_DEFAULTS } from "@/lib/service-catalog";

async function seedLegacy() {
  for (const name of LEGACY_DEMO_SERVICE_NAMES) await prisma.service.create({ data: { name, priceCents: 5000, durationMinutes: 60 } });
}

describe("Migração dos dados de manicure para a Garage Zero Zero", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it("desativa SÓ os 5 serviços de demonstração antigos (nome exato) e cadastra os 7 automotivos", async () => {
    await seedLegacy();
    // Serviço personalizado com nome parecido (NÃO é nome exato): não pode ser tocado.
    const custom = await prisma.service.create({ data: { name: "Manicure tradicional VIP", priceCents: 9000, durationMinutes: 60 } });

    const report = await migrateManicureServices(prisma);
    expect(report.deactivated.sort()).toEqual([...LEGACY_DEMO_SERVICE_NAMES].sort());
    expect(report.created.sort()).toEqual(DEFAULT_SERVICES.map((s) => s.name).sort());

    const legacy = await prisma.service.findMany({ where: { name: { in: [...LEGACY_DEMO_SERVICE_NAMES] } } });
    expect(legacy).toHaveLength(5); // nada foi apagado
    expect(legacy.every((s) => !s.active)).toBe(true);
    expect((await prisma.service.findUniqueOrThrow({ where: { id: custom.id } })).active).toBe(true);
    expect(await prisma.service.count({ where: { active: true } })).toBe(1 + DEFAULT_SERVICES.length);
  });

  it("é idempotente: a segunda execução não muda nem cria nada", async () => {
    await seedLegacy();
    await migrateManicureServices(prisma);
    const snapshot = JSON.stringify(await prisma.service.findMany({ orderBy: { name: "asc" } }));
    const second = await migrateManicureServices(prisma);
    expect(second).toMatchObject({ deactivated: [], created: [], settingsFieldsReset: [] });
    expect(JSON.stringify(await prisma.service.findMany({ orderBy: { name: "asc" } }))).toBe(snapshot);
  });

  it("não sobrescreve preço, duração nem estado de um serviço automotivo que a administração já tem (nem reativa o desativado)", async () => {
    const mine = await prisma.service.create({ data: { name: "Lavagem detalhada", priceCents: 77700, durationMinutes: 90 } });
    const off = await prisma.service.create({ data: { name: "Vitrificação", priceCents: 150000, durationMinutes: 360, active: false } });
    const report = await migrateManicureServices(prisma);
    expect(report.created).not.toContain("Lavagem detalhada");
    expect(report.created).not.toContain("Vitrificação");
    expect(await prisma.service.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ priceCents: 77700, durationMinutes: 90, active: true });
    expect(await prisma.service.findUniqueOrThrow({ where: { id: off.id } })).toMatchObject({ priceCents: 150000, durationMinutes: 360, active: false });
  });

  it("desativa o serviço antigo mesmo que o preço tenha sido editado (nome exato), sem apagar nem alterar reservas históricas", async () => {
    const old = await prisma.service.create({ data: { name: "Manicure tradicional", priceCents: 12345, durationMinutes: 45 } });
    const c = await createClient();
    const appt = await prisma.appointment.create({
      data: { clientId: c.id, serviceId: old.id, serviceName: old.name, priceCents: 4000, durationMinutes: 45, startAt: nextDayAt(9, 0, 3), endAt: nextDayAt(9, 45, 3) },
    });
    const before = JSON.stringify(appt);
    await migrateManicureServices(prisma);
    expect((await prisma.service.findUniqueOrThrow({ where: { id: old.id } })).active).toBe(false);
    expect(JSON.stringify(await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } }))).toBe(before); // histórico intacto
  });

  it("restaura ao padrão novo só os textos do site que ainda são IDÊNTICOS aos antigos; contatos e personalizações ficam", async () => {
    await prisma.siteSettings.create({
      data: { id: 1, siteName: LEGACY_SITE_DEFAULTS.siteName, tagline: "Meu slogan personalizado", intro: LEGACY_SITE_DEFAULTS.intro, phone: "(11) 3000-0000", address: "Rua A, 1", instagramUrl: "https://www.instagram.com/x" },
    });
    const report = await migrateManicureServices(prisma);
    expect(report.settingsFieldsReset.sort()).toEqual(["intro", "siteName"]);
    expect(await prisma.siteSettings.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({
      siteName: "",
      intro: "",
      tagline: "Meu slogan personalizado",
      phone: "(11) 3000-0000",
      address: "Rua A, 1",
      instagramUrl: "https://www.instagram.com/x",
    });
  });

  it("--dry-run não grava nada, mas relata o que faria", async () => {
    await seedLegacy();
    const report = await migrateManicureServices(prisma, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.deactivated).toHaveLength(5);
    expect(report.created).toHaveLength(7);
    expect(await prisma.service.count({ where: { active: true } })).toBe(5);
    expect(await prisma.service.count()).toBe(5);
  });
});
