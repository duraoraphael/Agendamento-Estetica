 
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb, openAllWeek, createClient, createService, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { createBooking } from "@/lib/booking";
import { backupFileName, parseBackupDate, selectBackupsToDelete } from "../scripts/lib/backup-retention";
import { diffSnapshots, findDataIssues, snapshot } from "../scripts/lib/data-checks";

const root = path.resolve(__dirname, "..");
const tsx = (script: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync("npx", ["tsx", script, ...args], { cwd: root, shell: true, env: { ...process.env, ...env }, stdio: "pipe" }).toString();
const json = (out: string) => JSON.parse(out.slice(out.indexOf("{")));

describe("Retenção de backups (função pura)", () => {
  const mk = (iso: string) => backupFileName(new Date(iso), "sqlite");

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

describe("Backup e restauração (SQLite) — executados de verdade", () => {
  let tmp: string;

  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-backup-"));
    const s = await createService({ priceCents: 5500, durationMinutes: 45 });
    const c = await createClient({ name: "Cliente Backup" });
    await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(10, 0, 3) });
    await createBooking({ clientId: c.id, serviceId: s.id, startAt: nextDayAt(11, 0, 3) });
  });

  it("gera backup verificado, restaura em OUTRO banco e o conteúdo é idêntico (contagens e hashes)", async () => {
    const out = json(tsx("scripts/backup.ts", [], { BACKUP_DIR: tmp }));
    expect(out.ok).toBe(true);
    expect(fs.existsSync(out.arquivo)).toBe(true);
    expect(out.appointments).toBe(2);
    expect(path.basename(out.arquivo)).toMatch(/^agenda-\d{8}-\d{6}\.sqlite$/);

    const target = path.join(tmp, "restaurado.db").replace(/\\/g, "/");
    const restored = json(tsx("scripts/restore.ts", [out.arquivo.replace(/\\/g, "/"), "--target", `file:${target}`]));
    expect(restored.ok).toBe(true);

    const other: any = new PrismaClient({ datasourceUrl: `file:${target}` });
    try {
      expect(diffSnapshots(await snapshot(prisma), await snapshot(other))).toEqual([]);
      expect(await other.appointment.count()).toBe(2);
      // preços históricos preservados
      expect((await other.appointment.findFirstOrThrow()).priceCents).toBe(5500);
    } finally {
      await other.$disconnect();
    }
  });

  it("a restauração se recusa a sobrescrever um banco existente sem --force", () => {
    const out = json(tsx("scripts/backup.ts", [], { BACKUP_DIR: tmp }));
    const target = path.join(tmp, "ja-existe.db").replace(/\\/g, "/");
    tsx("scripts/restore.ts", [out.arquivo.replace(/\\/g, "/"), "--target", `file:${target}`]);
    expect(() => tsx("scripts/restore.ts", [out.arquivo.replace(/\\/g, "/"), "--target", `file:${target}`])).toThrow();
    expect(json(tsx("scripts/restore.ts", [out.arquivo.replace(/\\/g, "/"), "--target", `file:${target}`, "--force"])).ok).toBe(true);
  });

  it("a retenção roda junto do backup e não apaga o backup novo", () => {
    for (const iso of ["2025-01-01T10:00:00Z", "2025-01-01T11:00:00Z"]) {
      fs.writeFileSync(path.join(tmp, backupFileName(new Date(iso), "sqlite")), "antigo");
    }
    const out = json(tsx("scripts/backup.ts", [], { BACKUP_DIR: tmp, BACKUP_KEEP_DAILY: "1", BACKUP_KEEP_MONTHLY: "1" }));
    expect(fs.existsSync(out.arquivo)).toBe(true);
    expect(out.apagadosPorRetencao.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Relatório de saneamento (findDataIssues)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("detecta sobreposição, situação inválida e reservas acima do limite, sem alterar nada", async () => {
    const c = await createClient();
    const s = await createService();
    const mkAppt = (start: string, end: string, status: string) =>
      prisma.appointment.create({
        data: { clientId: c.id, serviceId: s.id, serviceName: "x", priceCents: 1, durationMinutes: 60, startAt: new Date(start), endAt: new Date(end), status },
      });
    const a = await mkAppt("2099-01-10T10:00:00Z", "2099-01-10T11:00:00Z", "CONFIRMADA");
    const b = await mkAppt("2099-01-10T10:30:00Z", "2099-01-10T11:30:00Z", "CONFIRMADA"); // sobrepõe a
    await mkAppt("2099-01-10T11:00:00Z", "2099-01-10T12:00:00Z", "CANCELADA"); // não conta
    const foo = await mkAppt("2099-01-11T10:00:00Z", "2099-01-11T11:00:00Z", "FOO");
    await mkAppt("2099-01-12T10:00:00Z", "2099-01-12T11:00:00Z", "CONFIRMADA");
    await mkAppt("2099-01-13T10:00:00Z", "2099-01-13T11:00:00Z", "CONFIRMADA");

    const before = await prisma.appointment.count();
    const issues = await findDataIssues(prisma, { maxActiveFuture: 3 });
    const kinds = issues.map((i) => i.kind).sort();
    expect(kinds).toContain("SOBREPOSICAO");
    expect(kinds).toContain("STATUS_INVALIDO");
    expect(kinds).toContain("ACIMA_DO_LIMITE");
    expect(issues.find((i) => i.kind === "SOBREPOSICAO")!.ids.sort()).toEqual([a.id, b.id].sort());
    expect(issues.find((i) => i.kind === "STATUS_INVALIDO")!.ids).toEqual([foo.id]);
    expect(await prisma.appointment.count()).toBe(before); // somente leitura
  });

  it("dados limpos não geram problemas", async () => {
    const c = await createClient();
    const s = await createService();
    await prisma.appointment.create({
      data: { clientId: c.id, serviceId: s.id, serviceName: "x", priceCents: 1, durationMinutes: 60, startAt: new Date("2099-01-10T10:00:00Z"), endAt: new Date("2099-01-10T11:00:00Z"), status: "CONFIRMADA" },
    });
    await prisma.appointment.create({ // consecutiva: permitida
      data: { clientId: c.id, serviceId: s.id, serviceName: "x", priceCents: 1, durationMinutes: 60, startAt: new Date("2099-01-10T11:00:00Z"), endAt: new Date("2099-01-10T12:00:00Z"), status: "CONFIRMADA" },
    });
    expect(await findDataIssues(prisma, { maxActiveFuture: 3 })).toEqual([]);
  });
});
