 
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL, E2E_ENV } from "../playwright.config";

const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
const ADMIN = { email: E2E_ENV.ADMIN_EMAIL, password: E2E_ENV.ADMIN_PASSWORD };
const PASSWORD = "Tulipa-Rosa-42";
const stamp = Date.now().toString().slice(-7);

test.describe.configure({ mode: "serial" });

// Os dois projetos (desktop e celular) usam o MESMO banco, e o PostgreSQL recusa reservas ativas sobrepostas
// (restrição Appointment_no_overlap). O celular usa dias 21 à frente: cai em +30..+39, faixa que nenhum outro teste usa
// (agendamento do desktop: +9..+19; recursos: +18..+28 e +40..+54), então nunca colide com reservas de outro teste.
let dayShift = 0;
test.beforeEach(async ({}, info) => {
  dayShift = info.project.name === "desktop" ? 0 : 21;
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

// ---------- utilidades ----------
const issues = new WeakMap<Page, string[]>();

function watch(page: Page) {
  const list: string[] = [];
  issues.set(page, list);
  page.on("pageerror", (e) => list.push("pageerror: " + e.message));
  page.on("console", (m) => {
    // 4xx de login/cadastro intencionais aparecem como "Failed to load resource": são checados pelas respostas abaixo.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) list.push("console.error: " + m.text().slice(0, 200));
  });
  page.on("response", (r) => {
    const u = new URL(r.url());
    const expectedAuthFailure = u.pathname.startsWith("/api/auth/") && [400, 401, 429].includes(r.status());
    if (r.status() >= 400 && !expectedAuthFailure) list.push(`HTTP ${r.status()} ${u.pathname}`);
  });
  page.on("requestfailed", (r) => {
    // Pré-carregamentos (_rsc) cancelados pela própria navegação do Next não são falhas.
    if (/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) return;
    list.push("requestfailed: " + r.url());
  });
}

async function noHScroll(page: Page, label: string) {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    wide: [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5)
      .map((e) => e.tagName + "." + String((e as HTMLElement).className).slice(0, 40)),
  }));
  expect(r.sw, `${label}: largura do conteúdo ${r.sw}px > viewport ${r.iw}px. Elementos largos: ${r.wide.join(", ")}`).toBeLessThanOrEqual(r.iw + 1);
}

async function shot(page: Page, info: TestInfo, name: string) {
  const dir = path.join(__dirname, "screenshots", info.project.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + ".png") });
}

/** Confere a tela: sem rolagem horizontal e guarda a captura. */
async function check(page: Page, info: TestInfo, name: string) {
  await noHScroll(page, name);
  await shot(page, info, name);
}

function expectClean(page: Page) {
  expect(issues.get(page) ?? []).toEqual([]);
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login")); // espera o login concluir
}

/** Dia útil (ter–sex) daqui a `ahead` dias, no horário local do estúdio, devolvido como ISO UTC. */
function slotIso(ahead: number, hour: number): string {
  const base = new Date();
  for (let i = ahead + dayShift; i < ahead + dayShift + 14; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (d.getDay() >= 2 && d.getDay() <= 5) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return new Date(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00:00-03:00`).toISOString();
    }
  }
  throw new Error("sem dia útil");
}

/** `spanSeconds` encurta o intervalo gravado (sem mudar `durationMinutes`): permite reservas coladas, sem sobreposição. */
async function insertAppointment(clientId: string, startIso: string, status = "CONFIRMADA", minutes = 60, price = 6000, spanSeconds?: number) {
  const svc = await prisma.service.findFirstOrThrow({ where: { name: "Esmaltação em gel" } });
  const start = new Date(startIso);
  return prisma.appointment.create({
    data: { clientId, serviceId: svc.id, serviceName: svc.name, priceCents: price, durationMinutes: minutes, startAt: start, endAt: new Date(start.getTime() + (spanSeconds ?? minutes * 60) * 1000), status },
  });
}

const state: { name?: string; email?: string; clientId?: string; firstApptId?: string } = {};

// ---------- cliente ----------
test("cliente: cadastro, login, tela vazia, recarregar, menu e URL direta", async ({ page }, info) => {
  watch(page);
  state.email = `cli-${info.project.name}-${stamp}@example.com`;
  state.name = `Cliente Navegador ${info.project.name.replace("celular-390", "Celular")}`; // nome único por projeto

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Agendar horário" })).toBeVisible();
  const box = await page.getByRole("link", { name: "Agendar horário" }).boundingBox();
  expect(box!.y + box!.height, "'Agendar horário' deve aparecer sem rolar").toBeLessThanOrEqual(page.viewportSize()!.height);
  await check(page, info, "01-home");

  await page.goto("/meus-agendamentos");
  await expect(page).toHaveURL(/\/login\?callbackUrl=/); // visitante anônimo

  await page.goto("/cadastro");
  await page.getByLabel("Nome completo").fill(state.name!);
  await page.getByLabel("E-mail").fill(state.email);
  await page.getByLabel("Celular com DDD").fill("(11) 98888-7777");
  await page.getByLabel("Senha", { exact: true }).fill("12345678");
  await page.getByLabel("Confirmar senha").fill("12345678");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("muito comum")).toBeVisible(); // política de senha
  await check(page, info, "02-cadastro-erro");
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirmar senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Cadastro recebido")).toBeVisible();

  await login(page, state.email, PASSWORD);
  await expect(page).toHaveURL(/\/meus-agendamentos$/);
  await expect(page.getByText("Próximos horários")).toBeVisible();
  await expect(page.getByText("Histórico", { exact: true })).toBeVisible();
  await expect(page.getByText("Nenhum horário marcado")).toBeVisible(); // conta sem agendamentos
  await expect(page.getByText(/cancelar pelo site até 24 horas/)).toBeVisible(); // política visível
  await check(page, info, "03-meus-agendamentos-vazio");

  await page.reload();
  await expect(page).toHaveURL(/\/meus-agendamentos$/);
  await expect(page.getByText("Próximos horários")).toBeVisible();
  await page.goto("/meus-agendamentos");
  await expect(page.getByText("Próximos horários")).toBeVisible();
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Agendar", exact: true }).click();
  await expect(page).toHaveURL(/\/agendar$/);
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Meus agendamentos" }).click();
  await expect(page).toHaveURL(/\/meus-agendamentos$/);

  await page.goto("/admin"); // cliente não entra no painel
  await expect(page).toHaveURL(/\/meus-agendamentos$/);
  state.clientId = (await prisma.user.findUniqueOrThrow({ where: { email: state.email } })).id;
  expectClean(page);
});

test("cliente: reserva pela interface (3+ dias à frente) e aparece em Próximos horários", async ({ page }, info) => {
  watch(page);
  await login(page, state.email!, PASSWORD);
  await expect(page).toHaveURL(/\/meus-agendamentos$/);
  await page.goto("/agendar");
  await check(page, info, "04-servicos");
  await page.getByRole("link", { name: /Esmaltação em gel/ }).click();
  await expect(page).toHaveURL(/\/agendar\/horario/);

  const dayButtons = page.locator("fieldset button");
  await expect(dayButtons.first()).toBeVisible();
  let picked = false;
  for (let i = 3; i < Math.min(await dayButtons.count(), 14) && !picked; i++) {
    await dayButtons.nth(i).click();
    // A lista só traz horários livres; cada botão tem o próprio horário como nome ("14:00").
    const slot = page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first();
    try {
      await slot.waitFor({ state: "visible", timeout: 4000 });
      await slot.click();
      picked = true;
    } catch {
      /* dia sem horários: tenta o próximo */
    }
  }
  expect(picked, "deve existir um horário disponível").toBe(true);
  await check(page, info, "05-horarios");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/agendar\/revisar/);
  await expect(page.getByText(/cancelar pelo site até 24 horas/)).toBeVisible(); // política antes de confirmar
  await check(page, info, "06-revisar");
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page).toHaveURL(/confirmado=/); // o id da reserva vai na URL para o botão "Salvar no Google Agenda"
  await expect(page.getByText("Agendamento confirmado")).toBeVisible();
  await expect(page.getByText("Esmaltação em gel").first()).toBeVisible();
  await check(page, info, "07-confirmado");

  state.firstApptId = (await prisma.appointment.findFirstOrThrow({ where: { clientId: state.clientId }, orderBy: { createdAt: "desc" } })).id;
  expectClean(page);
});

test("cliente: limite de 3 reservas futuras ativas (aviso na tela e recusa no servidor)", async ({ page }, info) => {
  watch(page);
  await insertAppointment(state.clientId!, slotIso(9, 10));
  await insertAppointment(state.clientId!, slotIso(10, 10));
  await login(page, state.email!, PASSWORD);
  await page.goto("/agendar");
  await expect(page.getByText(/limite por cliente/)).toBeVisible();
  await check(page, info, "08-limite-aviso");

  // Mesmo ignorando a tela, o servidor recusa a 4ª reserva.
  const svc = await prisma.service.findFirstOrThrow({ where: { name: "Esmaltação em gel" } });
  await page.goto(`/agendar/revisar?serviceId=${svc.id}&startAt=${encodeURIComponent(slotIso(12, 15))}`);
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByRole("alert").or(page.getByText(/limite por cliente/)).first()).toBeVisible();
  await check(page, info, "09-limite-recusado");
  expect(await prisma.appointment.count({ where: { clientId: state.clientId!, status: "CONFIRMADA" } })).toBe(3);
  expectClean(page);
});

test("cliente: cancela com mais de 24h (duas etapas), preserva histórico e libera o horário", async ({ page }, info) => {
  watch(page);
  await login(page, state.email!, PASSWORD);
  const before = await prisma.appointment.findUniqueOrThrow({ where: { id: state.firstApptId! } });
  await page.goto(`/meus-agendamentos/${state.firstApptId}`);
  await expect(page.getByText(/cancelar pelo site até 24 horas/)).toBeVisible();
  await page.getByRole("button", { name: "Cancelar agendamento" }).click();
  await expect(page.getByText(/Tem certeza\?/)).toBeVisible(); // confirmação antes de cancelar
  await check(page, info, "10-cancelar-confirmar");
  await page.getByRole("button", { name: "Voltar" }).click();
  expect((await prisma.appointment.findUniqueOrThrow({ where: { id: state.firstApptId! } })).status).toBe("CONFIRMADA"); // "Voltar" não cancela
  await page.getByRole("button", { name: "Cancelar agendamento" }).click();
  await page.getByRole("button", { name: "Sim, cancelar" }).click();
  await expect(page.getByText("Cancelada").first()).toBeVisible();
  const after = await prisma.appointment.findUniqueOrThrow({ where: { id: state.firstApptId! } });
  expect(after.status).toBe("CANCELADA");
  expect(after.priceCents).toBe(before.priceCents); // histórico preservado
  await check(page, info, "11-cancelada");
  await page.goto("/meus-agendamentos");
  await expect(page.getByText("Cancelada").first()).toBeVisible(); // aparece no histórico
  expectClean(page);
});

test("cliente: com menos de 24h não há botão de cancelar; reserva de outra cliente dá 404", async ({ page }, info) => {
  watch(page);
  // Horas diferentes por projeto (menos de 24h nos dois): eles compartilham o banco e o PostgreSQL recusa sobreposição.
  const nearHours = info.project.name === "desktop" ? 5 : 8;
  const near = await insertAppointment(state.clientId!, new Date(Date.now() + nearHours * 3600_000).toISOString(), "CONFIRMADA", 30);
  const other = await prisma.user.create({
    data: { name: "Outra Cliente", email: `outra-${info.project.name}-${stamp}@example.com`, phone: "(11) 97777-6666", passwordHash: "x", role: "CLIENTE" },
  });
  const theirs = await insertAppointment(other.id, slotIso(11, 14));

  await login(page, state.email!, PASSWORD);
  await page.goto(`/meus-agendamentos/${near.id}`);
  await expect(page.getByText(/prazo para cancelar pelo site já passou/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar agendamento" })).toHaveCount(0);
  await check(page, info, "12-sem-cancelar");

  const res = await page.goto(`/meus-agendamentos/${theirs.id}`);
  expect(res!.status()).toBe(404);
  expect((await prisma.appointment.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("CONFIRMADA");
  issues.get(page)!.length = 0; // o 404 acima é o resultado esperado
});

test("teclado: foco percorre e-mail, senha e Entrar; Enter envia; erro é anunciado", async ({ page }) => {
  watch(page);
  await page.goto("/login");
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => document.activeElement?.id || (document.activeElement as HTMLElement)?.innerText?.trim().slice(0, 12) || ""));
  }
  expect(seen).toEqual(expect.arrayContaining(["email", "password", "Entrar"]));
  await page.getByLabel("E-mail").focus();
  await page.keyboard.type("naoexiste@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.type("qualquer-senha");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/incorretos/)).toBeVisible();
  expect(await page.locator("[role=alert], [aria-live]").count()).toBeGreaterThan(0);
  expectClean(page);
});

// ---------- administradora ----------
test("administradora: lista, aviso de novos, GET não grava, filtros inválidos, calendário e conflito ao reativar", async ({ page }, info) => {
  watch(page);
  await login(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/admin$/);
  await check(page, info, "13-admin-hoje");
  await expect(page.getByText(/novo/).first()).toBeVisible(); // aviso de novos agendamentos

  // Abrir/pré-carregar por GET não altera o banco
  const adminRow = () => prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  const seenBefore = (await adminRow()).notificationsSeenAt.getTime();
  for (let i = 0; i < 3; i++) await page.request.get("/admin/agendamentos", { headers: { "next-router-prefetch": "1", rsc: "1" } });
  await page.request.get("/admin/agendamentos");
  expect((await adminRow()).notificationsSeenAt.getTime()).toBe(seenBefore);

  const mine = await prisma.appointment.findFirstOrThrow({ where: { clientId: state.clientId!, status: "CONFIRMADA" }, orderBy: { startAt: "asc" } });
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(mine.startAt);
  await page.goto(`/admin/agendamentos?from=${key}&to=${key}`);
  await expect.poll(async () => (await adminRow()).notificationsSeenAt.getTime()).toBeGreaterThan(seenBefore); // abrir marca como visto
  await expect(page.getByText(state.name!).first()).toBeVisible();
  await check(page, info, "14-admin-lista");

  // CONCLUIDA em atendimento futuro: recusado com mensagem
  const row = page.getByRole("row").filter({ hasText: state.name! }).first();
  await row.getByRole("combobox").selectOption("CONCLUIDA");
  await expect(page.getByText(/depois do horário do atendimento/)).toBeVisible();
  await check(page, info, "15-admin-erro-status");

  // Reativar reserva cuja vaga foi ocupada por outra cliente: conflito, continua cancelada
  const reativa = await prisma.user.create({ data: { name: `Reativa ${info.project.name}`, email: `reat-${info.project.name}-${stamp}@example.com`, phone: "(11) 94444-3333", passwordHash: "x", role: "CLIENTE" } });
  const other = await prisma.user.create({ data: { name: "Dona Conflito", email: `conf-${info.project.name}-${stamp}@example.com`, phone: "(11) 96666-5555", passwordHash: "x", role: "CLIENTE" } });
  const iso = slotIso(15, 16);
  const cancelled = await insertAppointment(reativa.id, iso, "CANCELADA");
  await insertAppointment(other.id, iso, "CONFIRMADA");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
  await page.goto(`/admin/agendamentos?from=${day}&to=${day}`);
  await page.getByRole("row").filter({ hasText: `Reativa ${info.project.name}` }).getByRole("combobox").selectOption("CONFIRMADA");
  await expect(page.getByText(/já foi ocupado por outra reserva/)).toBeVisible();
  expect((await prisma.appointment.findUniqueOrThrow({ where: { id: cancelled.id } })).status).toBe("CANCELADA");
  await check(page, info, "16-admin-conflito-reativar");

  // Reativar para uma cliente que já está no limite de reservas futuras: recusado, continua cancelada
  const full = await prisma.appointment.findUniqueOrThrow({ where: { id: state.firstApptId! } }); // cancelada pela cliente no teste anterior
  const fullDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(full.startAt);
  await page.goto(`/admin/agendamentos?from=${fullDay}&to=${fullDay}`);
  await page.getByRole("row").filter({ hasText: state.name! }).first().getByRole("combobox").selectOption("CONFIRMADA");
  await expect(page.getByText(/limite configurado/)).toBeVisible();
  expect((await prisma.appointment.findUniqueOrThrow({ where: { id: full.id } })).status).toBe("CANCELADA");
  await check(page, info, "16b-admin-limite-reativar");

  for (const p of ["/admin/agendamentos?from=abc&to=xyz", "/admin/agendamentos?view=calendario&month=zzz", "/admin/agendamentos?status=FOO", "/admin/faturamento?ref=abc", "/admin/faturamento?kind=MENSAL&ref=2026-13-45"]) {
    const r = await page.goto(p);
    expect(r!.status(), p).toBe(200);
  }
  await page.goto("/admin/agendamentos?view=calendario");
  await expect(page.getByText(/20\d\d/).first()).toBeVisible();
  await check(page, info, "17-admin-calendario");
  expectClean(page);
});

test("administradora: faturamento diário, semanal e mensal com dados conhecidos nas viradas (fuso do estúdio)", async ({ page }, info) => {
  watch(page);
  const c = await prisma.user.create({ data: { name: "Cliente Fatura", email: `fat-${info.project.name}-${stamp}@example.com`, phone: "(11) 95555-4444", passwordHash: "x", role: "CLIENTE" } });
  // Cada reserva ocupa só 1 segundo: as viradas ficam 1 s uma da outra e o PostgreSQL recusa sobreposição.
  const at = (iso: string, price: number, status: string) => insertAppointment(c.id, iso, status, 1, price, 1);
  // Segunda-feira de referência distinta por projeto (os dois projetos compartilham o mesmo banco).
  const [Y, D] = info.project.name === "desktop" ? [2031, 10] : [2032, 8];
  const p2 = (n: number) => String(n).padStart(2, "0");
  const dd = (n: number) => `${Y}-03-${p2(n)}`;
  await at(`${dd(D)}T03:00:00Z`, 2_00, "CONCLUIDA"); // segunda 00:00:00 local
  await at(`${dd(D + 1)}T02:59:59Z`, 4_00, "CONCLUIDA"); // segunda 23:59:59 local
  await at(`${dd(D + 1)}T03:00:00Z`, 8_00, "CONCLUIDA"); // terça 00:00:00 local
  await at(`${dd(D)}T15:00:00Z`, 10_00, "CONFIRMADA"); // previsto na segunda 12:00
  await at(`${dd(D)}T16:00:00Z`, 500_00, "CANCELADA");
  await at(`${dd(D)}T17:00:00Z`, 700_00, "FALTA");

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto(`/admin/faturamento?kind=DIARIO&ref=${dd(D)}`);
  await expect(page.getByText(/R\$\s*6,00/).first()).toBeVisible(); // concluído do dia: 2,00 + 4,00
  await expect(page.getByText(/R\$\s*10,00/).first()).toBeVisible(); // previsto
  await expect(page.getByText(/R\$\s*500,00|R\$\s*700,00/)).toHaveCount(0); // cancelada/falta fora
  await check(page, info, "18-faturamento-diario");
  await page.goto(`/admin/faturamento?kind=DIARIO&ref=${dd(D + 1)}`);
  await expect(page.getByText(/R\$\s*8,00/).first()).toBeVisible();
  await page.goto(`/admin/faturamento?kind=SEMANAL&ref=${dd(D + 2)}`);
  await expect(page.getByText(/R\$\s*14,00/).first()).toBeVisible(); // 2 + 4 + 8
  await check(page, info, "19-faturamento-semanal");
  await page.goto(`/admin/faturamento?kind=MENSAL&ref=${dd(D + 10)}`);
  await expect(page.getByText(/R\$\s*14,00/).first()).toBeVisible();
  await check(page, info, "20-faturamento-mensal");
  expectClean(page);
});
