import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { safeCallbackPath } from "@/lib/safe-redirect";
import { backupFileName, positiveIntOr, selectBackupsToDelete } from "../scripts/lib/backup-retention";
import { register, shouldStartGoogleSyncWorker } from "@/instrumentation";

const root = path.resolve(__dirname, "..");
const run = (script: string, args: string[], env: Record<string, string> = {}) => {
  try {
    const out = execFileSync("npx", ["tsx", script, ...args], { cwd: root, shell: true, env: { ...process.env, ...env }, stdio: "pipe" }).toString();
    return { status: 0, out, err: "" };
  } catch (e: any) {
    return { status: e.status as number, out: String(e.stdout ?? ""), err: String(e.stderr ?? "") };
  }
};

describe("Redirecionamento pós-login (anti redirecionamento aberto)", () => {
  it("aceita só caminhos do próprio site", () => {
    expect(safeCallbackPath("/meus-agendamentos")).toBe("/meus-agendamentos");
    expect(safeCallbackPath("/agendar/horario?serviceId=abc#x")).toBe("/agendar/horario?serviceId=abc#x");
    expect(safeCallbackPath(undefined)).toBe("/");
    expect(safeCallbackPath(null)).toBe("/");
    expect(safeCallbackPath("")).toBe("/");
  });

  it("rejeita URLs externas e variações usadas para burlar a checagem", () => {
    for (const bad of [
      "https://evil.example/login",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "http://localhost:3000.evil.example",
      "/%0d%0aSet-Cookie:x=1".replace("%0d%0a", "\r\n"),
      "\\\\evil.example",
      "evil.example",
      "data:text/html,x",
    ]) {
      expect(safeCallbackPath(bad), bad).toBe("/");
    }
  });
});

describe("Retenção de backups: configuração inválida não apaga os backups", () => {
  it("positiveIntOr usa o padrão para NaN, 0, vazio, negativo e decimal", () => {
    for (const bad of ["abc", "0", "", "  ", "-3", "2.5", undefined]) expect(positiveIntOr(bad as string | undefined, 14), String(bad)).toBe(14);
    expect(positiveIntOr("7", 14)).toBe(7);
  });

  it("com valores inválidos a retenção ainda mantém os 14 dias padrão", () => {
    const names = Array.from({ length: 30 }, (_, i) => backupFileName(new Date(Date.UTC(2026, 9, 1 + i, 3)), "sqlite"));
    const keepDaily = positiveIntOr("abc", 14);
    const deleted = selectBackupsToDelete(names, { keepDaily, keepMonthly: positiveIntOr("", 6) });
    expect(names.length - deleted.length).toBeGreaterThanOrEqual(14);
  });
});

describe("Restauração PostgreSQL segura", () => {
  const dumpFile = () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-ops-"));
    const f = path.join(tmp, "b.dump");
    fs.writeFileSync(f, "x");
    return f.replace(/\\/g, "/");
  };

  it("recusa restaurar sobre o banco em uso (DATABASE_URL) e não imprime a senha", () => {
    const r = run("scripts/restore.ts", [dumpFile(), "--target", process.env.DATABASE_URL as string, "--force"]);
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/banco em uso/);
    expect(r.err + r.out).not.toContain("pg-test-only"); // a senha do banco nunca aparece
  });

  it("destino que não é PostgreSQL é recusado", () => {
    const r = run("scripts/restore.ts", [dumpFile(), "--target", "file:./qualquer.db"]);
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/PostgreSQL/);
  });
});

describe("Backup: falha não deixa arquivo parcial nem vaza a senha", () => {
  it("banco inacessível / pg_dump ausente: falha, sem arquivo no diretório de backups e sem a senha na saída", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-ops-"));
    const r = run("scripts/backup.ts", [], {
      DIRECT_URL: "postgresql://postgres:SENHA-SECRETA-123@127.0.0.1:1/agenda",
      PG_BIN_DIR: path.join(tmp, "sem-pg-dump"),
      BACKUP_DIR: tmp,
    });
    expect(r.status).not.toBe(0);
    expect(fs.readdirSync(tmp).filter((f) => f.startsWith("agenda-"))).toEqual([]);
    expect(r.err + r.out).not.toContain("SENHA-SECRETA-123");
  });

  it("URL que não é PostgreSQL é recusada", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-ops-"));
    const r = run("scripts/backup.ts", [], { DIRECT_URL: "file:./dev.db", BACKUP_DIR: tmp });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/PostgreSQL/);
  });
});

describe("Segredos fracos em produção", () => {
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    try {
      fn();
    } finally {
      process.env = prev;
    }
  };

  it("em produção recusa NEXTAUTH_SECRET curto ou de exemplo; aceita um forte", () => {
    const base = { NODE_ENV: "production", NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-server" };
    withEnv({ ...base, NEXTAUTH_SECRET: "coloque-um-segredo-aleatorio-aqui" }, () => expect(() => register()).toThrow(/NEXTAUTH_SECRET/));
    withEnv({ ...base, NEXTAUTH_SECRET: "curto" }, () => expect(() => register()).toThrow(/NEXTAUTH_SECRET/));
    withEnv({ ...base, NEXTAUTH_SECRET: "x".repeat(10) + "Ab9$".repeat(10) }, () => expect(() => register()).not.toThrow());
  });

  it("fora de produção e durante o build não exige", () => {
    withEnv({ NODE_ENV: "development", NEXTAUTH_SECRET: "" }, () => expect(() => register()).not.toThrow());
    withEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build", NEXTAUTH_SECRET: "" }, () => expect(() => register()).not.toThrow());
  });
});

describe("Worker do Google Agenda no ambiente de hospedagem", () => {
  it("não inicia temporizador em build, testes, Edge, Vercel ou quando foi desligado", () => {
    const base = { NODE_ENV: "production", NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-server" };

    expect(shouldStartGoogleSyncWorker({ ...base, NEXT_PHASE: "phase-production-build" })).toBe(false);
    expect(shouldStartGoogleSyncWorker({ ...base, NODE_ENV: "test" })).toBe(false);
    expect(shouldStartGoogleSyncWorker({ ...base, NEXT_RUNTIME: "edge" })).toBe(false);
    expect(shouldStartGoogleSyncWorker({ ...base, VERCEL: "1" })).toBe(false);
    expect(shouldStartGoogleSyncWorker({ ...base, GOOGLE_SYNC_WORKER: "off" })).toBe(false);
  });

  it("mantém o temporizador em servidor Node de processo fixo", () => {
    expect(
      shouldStartGoogleSyncWorker({
        NODE_ENV: "production",
        NEXT_RUNTIME: "nodejs",
        NEXT_PHASE: "phase-production-server",
      })
    ).toBe(true);
  });
});
