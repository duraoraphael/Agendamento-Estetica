import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { PG_TEST_URL_FOR, PG_TEST_URL } from "./pg-env";

const root = path.resolve(__dirname, "..");
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { cwd: root, shell: true, env: { ...process.env, ...env }, encoding: "utf8" });

let seq = 0;
async function newPgTarget(prepare = true): Promise<{ db: string; url: string }> {
  const db = `agenda_mig_${Date.now()}_${seq++}`;
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${db}"`);
  const url = PG_TEST_URL_FOR(db);
  if (prepare) {
    const r = run("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/postgres/schema.prisma"], { DATABASE_URL: url });
    expect(r.status, r.stderr).toBe(0);
  }
  return { db, url };
}

function makeSample(mode: "clean" | "overlap" | "foo"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-sample-"));
  const file = path.join(dir, "sample.db").replace(/\\/g, "/");
  const env = { DATABASE_URL: "file:" + file };
  const m = run("npx", ["prisma", "migrate", "deploy"], env); // migrações do SQLite
  expect(m.status, m.stderr).toBe(0);
  const s = run("npx", ["tsx", "tests-pg/fixtures/make-sample-sqlite.ts", file, mode], env);
  expect(s.status, s.stderr).toBe(0);
  return file;
}

const migrate = (file: string, targetUrl: string, extra: string[] = []) =>
  run("npx", ["tsx", "scripts/migrate-sqlite-to-postgres.ts", "--source", `file:${file}`, "--target", `"${targetUrl}"`, ...extra]);

async function countsIn(url: string): Promise<Record<string, number>> {
  // lê o destino com um cliente PG independente
  const { PrismaClient } = require(path.resolve(root, ".prisma-pg-client"));
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    return {
      user: await db.user.count(),
      service: await db.service.count(),
      appointment: await db.appointment.count(),
      businessHours: await db.businessHours.count(),
      blockedPeriod: await db.blockedPeriod.count(),
    };
  } finally {
    await db.$disconnect();
  }
}

describe("Migração SQLite → PostgreSQL (cópias isoladas)", () => {
  beforeAll(() => {
    expect(PG_TEST_URL).toContain("127.0.0.1");
  });

  it("dados limpos: copia tudo, preserva IDs/relacionamentos/horários/preços históricos/status e verifica por hash", async () => {
    const file = makeSample("clean");
    const { url } = await newPgTarget();
    const r = migrate(file, url);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
    expect(report.ok).toBe(true);
    expect(report.tabelasCopiadas.appointment.count).toBe(6);

    const { PrismaClient } = require(path.resolve(root, ".prisma-pg-client"));
    const pg = new PrismaClient({ datasourceUrl: url });
    try {
      expect(await countsIn(url)).toEqual({ user: 3, service: 2, appointment: 6, businessHours: 7, blockedPeriod: 1 });
      const a1 = await pg.appointment.findUniqueOrThrow({ where: { id: "a-1" } });
      expect(a1.priceCents).toBe(6000); // preço histórico (o serviço hoje custa 9900)
      expect(a1.clientId).toBe("u-ana");
      expect(a1.startAt.toISOString()).toBe("2099-01-10T10:00:00.000Z");
      expect(a1.endAt.toISOString()).toBe("2099-01-10T11:00:00.000Z");
      expect((await pg.appointment.findUniqueOrThrow({ where: { id: "a-3" } })).status).toBe("CANCELADA");
      expect((await pg.appointment.findUniqueOrThrow({ where: { id: "a-5" } })).status).toBe("CONCLUIDA");
      expect((await pg.service.findUniqueOrThrow({ where: { id: "s-gel" } })).priceCents).toBe(9900);
      expect((await pg.user.findUniqueOrThrow({ where: { id: "u-admin" } })).role).toBe("ADMIN");
      expect((await pg.bookingLock.findUniqueOrThrow({ where: { id: 1 } })).version).toBe(7);
      const tok = (await pg.googleCalendarAccount.findUniqueOrThrow({ where: { id: "g-1" } })).accessToken;
      expect(tok).not.toContain("access-fake"); // segue criptografado
      expect(decryptSecret(tok)).toBe("access-fake"); // e legível com a mesma chave
      // a restrição do banco está ativa nos dados migrados: nova sobreposição é recusada
      await expect(
        pg.$executeRaw`INSERT INTO "Appointment" ("id","clientId","serviceId","serviceName","priceCents","durationMinutes","startAt","endAt","status","googleSyncStatus","createdAt","updatedAt")
          VALUES ('z','u-ana','s-gel','x',1,60,'2099-01-10T10:30:00'::timestamp,'2099-01-10T11:30:00'::timestamp,'CONFIRMADA','NAO_CONECTADO',NOW(),NOW())`
      ).rejects.toThrow(/no_overlap|23P01/);
    } finally {
      await pg.$disconnect();
    }
  });

  it("dry-run só verifica: não grava nada no destino", async () => {
    const file = makeSample("clean");
    const { url } = await newPgTarget();
    const r = migrate(file, url, ["--dry-run"]);
    expect(r.status, r.stderr).toBe(0);
    expect((await countsIn(url)).appointment).toBe(0);
  });

  it("sobreposição nos dados: PARA com relatório (código 2) e não grava nada", async () => {
    const file = makeSample("overlap");
    const { url } = await newPgTarget();
    const r = migrate(file, url);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/SOBREPOSICAO/);
    expect(r.stderr).toMatch(/a-x/);
    expect(r.stderr).toMatch(/Nada foi gravado/);
    expect(await countsIn(url)).toEqual({ user: 0, service: 0, appointment: 0, businessHours: 0, blockedPeriod: 0 });
  });

  it("situação inválida (FOO): PARA com relatório e não grava nada", async () => {
    const file = makeSample("foo");
    const { url } = await newPgTarget();
    const r = migrate(file, url);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/STATUS_INVALIDO/);
    expect((await countsIn(url)).user).toBe(0);
  });

  it("chave de criptografia diferente no ambiente de destino: PARA (código 5) e não grava nada", async () => {
    const file = makeSample("clean");
    const { url } = await newPgTarget();
    const r = run("npx", ["tsx", "scripts/migrate-sqlite-to-postgres.ts", "--source", `file:${file}`, "--target", `"${url}"`], {
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), // outra chave de 32 bytes
    });
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/TOKEN_ENCRYPTION_KEY/);
    expect((await countsIn(url)).user).toBe(0);
  });

  it("destino que não está vazio ou não foi preparado: PARA (código 3)", async () => {
    const file = makeSample("clean");
    const first = await newPgTarget();
    expect(migrate(file, first.url).status).toBe(0);
    expect(migrate(file, first.url).status).toBe(3); // já tem dados
    const bare = await newPgTarget(false); // sem migrações
    expect(migrate(file, bare.url).status).toBe(3);
  });
});
