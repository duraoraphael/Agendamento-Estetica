 
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, createClient, createService } from "./helpers";
import { prisma } from "@/lib/db";
import { backupFileName, parseBackupDate, selectBackupsToDelete } from "../scripts/lib/backup-retention";
import { findDataIssues } from "../scripts/lib/data-checks";

describe("Retenção de backups (função pura)", () => {
  const mk = (iso: string) => backupFileName(new Date(iso), "dump");

  it("nome do arquivo é reversível e usa UTC", () => {
    const d = new Date("2026-11-04T23:59:58Z");
    expect(backupFileName(d, "dump")).toBe("agenda-20261104-235958.dump");
    expect(parseBackupDate("agenda-20261104-235958.dump")?.toISOString()).toBe(d.toISOString());
    expect(parseBackupDate("qualquer-coisa.txt")).toBeNull();
  });

  it("mantém 1 por dia nos últimos 14 dias + 1 por mês nos últimos 6; apaga o resto", () => {
    const names: string[] = [];
    // 40 dias seguidos, 2 backups por dia
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.UTC(2026, 10, 30) - i * 86400_000);
      names.push(mk(new Date(day.getTime() + 3 * 3600_000).toISOString()), mk(new Date(day.getTime() + 15 * 3600_000).toISOString()));
    }
    const del = new Set(selectBackupsToDelete(names));
    const kept = names.filter((n) => !del.has(n));
    // 14 dias recentes (o mais novo de cada dia) + mensais (último de out/set... se fora dos 14 dias)
    const days = new Set(kept.map((n) => n.slice(7, 15)));
    expect(days.size).toBeGreaterThanOrEqual(14);
    expect(kept).toContain(mk("2026-11-30T15:00:00Z")); // o mais recente nunca é apagado
    expect(del.has(mk("2026-11-30T03:00:00Z"))).toBe(true); // o mais antigo do mesmo dia é apagado
    expect(kept.length).toBeLessThan(names.length);
  });

  it("nunca apaga o único backup nem arquivos fora do padrão", () => {
    expect(selectBackupsToDelete([mk("2026-01-01T00:00:00Z")])).toEqual([]);
    expect(selectBackupsToDelete(["notas.txt", "agenda-manual.sqlite"])).toEqual([]);
  });
});

describe("Relatório de saneamento (findDataIssues)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  // Sobreposição, situação inválida, papel inválido e intervalo invertido NÃO podem mais existir: o PostgreSQL os recusa
  // por restrição (provado em tests/db-constraints.test.ts). O relatório cobre o que o banco não impede.
  const mkAppt = (clientId: string, serviceId: string, start: string, end: string) =>
    prisma.appointment.create({
      data: { clientId, serviceId, serviceName: "x", priceCents: 1, durationMinutes: 60, startAt: new Date(start), endAt: new Date(end), status: "CONFIRMADA" },
    });

  it("detecta cliente acima do limite de reservas futuras e e-mails repetidos (só caixa diferente), sem alterar nada", async () => {
    const c = await createClient();
    const s = await createService();
    for (const day of [10, 11, 12, 13]) await mkAppt(c.id, s.id, `2099-01-${day}T10:00:00Z`, `2099-01-${day}T11:00:00Z`);
    // O índice único do e-mail diferencia maiúsculas; o cadastro normaliza para minúsculas, então isto indica dado de fora.
    const upper = await createClient({ email: "Maria@Example.com" });
    const lower = await createClient({ email: "maria@example.com" });

    const before = { appointments: await prisma.appointment.count(), users: await prisma.user.count() };
    const issues = await findDataIssues(prisma, { maxActiveFuture: 3 });
    expect(issues.map((i) => i.kind).sort()).toEqual(["ACIMA_DO_LIMITE", "EMAIL_DUPLICADO"]);
    expect(issues.find((i) => i.kind === "EMAIL_DUPLICADO")!.ids.sort()).toEqual([upper.id, lower.id].sort());
    expect((await prisma.appointment.count()) === before.appointments && (await prisma.user.count()) === before.users).toBe(true); // somente leitura
  });

  it("dados limpos (inclusive reservas consecutivas) não geram problemas", async () => {
    const c = await createClient();
    const s = await createService();
    await mkAppt(c.id, s.id, "2099-01-10T10:00:00Z", "2099-01-10T11:00:00Z");
    await mkAppt(c.id, s.id, "2099-01-10T11:00:00Z", "2099-01-10T12:00:00Z"); // consecutiva: permitida
    expect(await findDataIssues(prisma, { maxActiveFuture: 3 })).toEqual([]);
  });
});
