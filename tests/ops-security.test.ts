import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { safeCallbackPath } from "@/lib/safe-redirect";
import { backupFileName, positiveIntOr, selectBackupsToDelete } from "../scripts/lib/backup-retention";
import { register } from "@/instrumentation";

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

describe("Restauração SQLite segura", () => {
  it("recusa restaurar sobre o banco em uso (DATABASE_URL) e não o toca", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-ops-"));
    const fake = path.join(tmp, "b.sqlite");
    fs.writeFileSync(fake, "x");
    const r = run("scripts/restore.ts", [fake.replace(/\\/g, "/"), "--target", "file:./test.db", "--force"]);
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/banco em uso/);
  });

  it("backup corrompido NÃO destrói um destino bom (copia para temporário, confere, só então substitui)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-ops-"));
    const good = path.join(tmp, "destino.db");
    fs.writeFileSync(good, "CONTEUDO-BOM");
    const corrupt = path.join(tmp, "corrompido.sqlite");
    fs.writeFileSync(corrupt, "isto não é um banco sqlite");
    const r = run("scripts/restore.ts", [corrupt.replace(/\\/g, "/"), "--target", `file:${good.replace(/\\/g, "/")}`, "--force"]);
    expect(r.status).not.toBe(0);
    expect(fs.readFileSync(good, "utf8")).toBe("CONTEUDO-BOM"); // destino intacto
    expect(fs.existsSync(good + ".restoring")).toBe(false); // temporário removido
  });
});

describe("Backup: falha não deixa arquivo parcial", () => {
  it("DATABASE_URL inexistente falha e não cria arquivo no diretório de backups", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-ops-"));
    const r = run("scripts/backup.ts", [], { DATABASE_URL: "file:" + path.join(tmp, "nao-existe", "x.db").replace(/\\/g, "/"), BACKUP_DIR: tmp });
    expect(r.status).not.toBe(0);
    expect(fs.readdirSync(tmp).filter((f) => f.startsWith("agenda-"))).toEqual([]);
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
