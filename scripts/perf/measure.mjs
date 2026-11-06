/**
 * Mede navegação num servidor JÁ em execução (dev ou produção), com Edge real via Playwright.
 *   node scripts/perf/measure.mjs <baseUrl> <rotulo> [saida.json]
 * Métricas:
 *  - primeira visita: goto -> h1 visível (inclui compilação sob demanda no `next dev`)
 *  - navegação aquecida: clique no menu -> h1 da página de destino visível (mediana de 5 rodadas)
 *  - requisições /api/auth/session e total de JS (bytes) por página
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [baseUrl, label = "run", out] = process.argv.slice(2);
const ADMIN = { email: "admin.perf@example.com", password: "Perf-Admin#2026x" };
const CLIENT = { email: "cliente.perf@example.com", password: "Perf-Client#2026x" };

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function login(page, creds) {
  // Espera a hidratação: preencher antes dela faz o React zerar os campos controlados.
  await page.goto(baseUrl + "/login", { waitUntil: "networkidle" });
  await page.getByLabel(/e-?mail/i).fill(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 });
  await page.waitForLoadState("networkidle");
}

function track(page) {
  const stats = { session: 0, jsBytes: 0, requests: 0, serverMs: [] };
  page.on("request", (r) => {
    stats.requests++;
    if (r.url().includes("/api/auth/session")) stats.session++;
  });
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (url.endsWith(".js") || url.includes(".js?")) stats.jsBytes += (await res.body()).length;
    } catch {}
  });
  return stats;
}

async function firstVisit(page, path, h1) {
  const t0 = Date.now();
  const resp = await page.goto(baseUrl + path, { waitUntil: "domcontentloaded" });
  await page.locator("h1", { hasText: h1 }).first().waitFor({ timeout: 120000 });
  const ms = Date.now() - t0;
  const t = resp?.request().timing();
  const ttfb = t ? Math.round(t.responseStart) : null;
  return { path, ms, ttfb };
}

async function clickNav(page, linkName, h1) {
  const t0 = Date.now();
  await page.getByRole("navigation", { name: /painel|principal/i }).getByRole("link", { name: linkName, exact: true }).click();
  await page.locator("h1", { hasText: h1 }).first().waitFor({ timeout: 120000 });
  return Date.now() - t0;
}

const result = { label, baseUrl, at: new Date().toISOString(), first: [], warm: {}, extras: {} };
const browser = await chromium.launch({ channel: "msedge" });

// ---- Administradora ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
  const page = await ctx.newPage();
  await login(page, ADMIN);
  const stats = track(page);
  const pages = [
    ["/admin", "Agendamentos de hoje"],
    ["/admin/faturamento", "Faturamento"],
    ["/admin/agendamentos", "Agendamentos"],
  ];
  for (const [p, h1] of pages) {
    stats.jsBytes = 0; stats.session = 0;
    const r = await firstVisit(page, p, h1);
    await page.waitForLoadState("networkidle");
    r.jsKB = Math.round(stats.jsBytes / 1024); r.sessionCalls = stats.session;
    result.first.push(r);
  }
  // Navegação aquecida: Hoje -> Faturamento -> Agendamentos -> Hoje (5 rodadas)
  const seq = [["Faturamento", "Faturamento"], ["Agendamentos", "Agendamentos"], ["Hoje", "Agendamentos de hoje"]];
  await page.goto(baseUrl + "/admin", { waitUntil: "networkidle" });
  const samples = Object.fromEntries(seq.map(([n]) => [n, []]));
  for (let round = 0; round < 6; round++) {
    stats.session = 0;
    for (const [name, h1] of seq) {
      const ms = await clickNav(page, name, h1);
      if (round > 0) samples[name].push(ms); // a rodada 0 aquece
      await page.waitForLoadState("networkidle");
    }
    result.extras.sessionCallsPerRound = stats.session;
  }
  for (const [n, a] of Object.entries(samples)) result.warm["admin→" + n] = { medianMs: median(a), samples: a };
  await ctx.close();
}

// ---- Cliente: lista de horários ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "pt-BR", isMobile: true });
  const page = await ctx.newPage();
  await login(page, CLIENT);
  const t0 = Date.now();
  await page.goto(baseUrl + "/agendar", { waitUntil: "domcontentloaded" });
  await page.locator("h1", { hasText: "Escolha o serviço" }).waitFor({ timeout: 120000 });
  result.extras.clientAgendarMs = Date.now() - t0;
  const t1 = Date.now();
  await page.locator('a[href^="/agendar/horario"]').first().click();
  await page.locator("h1", { hasText: "Escolha o dia" }).waitFor({ timeout: 120000 });
  result.extras.clientToHorarioPageMs = Date.now() - t1;
  await page.waitForLoadState("networkidle");
  // Troca de dia: clique -> resposta da Server Action de horários concluída e lista pintada.
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const t2 = Date.now();
    const respP = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/agendar/horario"), { timeout: 120000 });
    await page.locator("button[aria-pressed]", { hasText: /Amanhã|\d\d\/\d\d/ }).nth(2 + i).click();
    await (await respP).finished();
    await page.locator('section[aria-busy="false"]').waitFor();
    if (i > 0) samples.push(Date.now() - t2);
  }
  result.extras.clientChangeDaySlotsMs = median(samples);
  await ctx.close();
}

await browser.close();
const json = JSON.stringify(result, null, 2);
if (out) fs.writeFileSync(out, json);
console.log(json);
