import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL, E2E_ENV } from "../playwright.config";

/**
 * Página /admin/logs (trilha de auditoria): proteção de acesso (visitante, cliente), abas por categoria, eventos
 * reais de login recusado, login, logout e agendamento, e o layout nas duas larguras. Mesmo build de produção e mesmo
 * banco descartável dos demais testes de tela.
 */
const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
const ADMIN = { email: E2E_ENV.ADMIN_EMAIL, password: E2E_ENV.ADMIN_PASSWORD };
const PASSWORD = "Tulipa-Rosa-42";
const stamp = Date.now().toString().slice(-7);

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function shot(page: Page, info: TestInfo, name: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(r.sw, `${name}: a página rolou na horizontal (${r.sw}px > ${r.iw}px)`).toBeLessThanOrEqual(r.iw + 1);
  const dir = path.join(__dirname, "screenshots", info.project.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + ".png") });
}

test("quem não é administradora não acessa os logs (visitante e cliente)", async ({ page, browser, baseURL }, info) => {
  // Visitante: vai para o login.
  await page.goto("/admin/logs");
  await expect(page).toHaveURL(/\/login/);

  // Cliente: vai para a própria área, e a tela de logs nunca aparece.
  const email = `logs-cliente-${stamp}-${info.project.name}@example.com`;
  await prisma.user.create({ data: { name: "Cliente Logs", email, phone: "(11) 98888-1111", passwordHash: bcrypt.hashSync(PASSWORD, 10), role: "CLIENTE" } });
  const ctx = await browser.newContext({ baseURL: baseURL ?? undefined, locale: "pt-BR" });
  const clientPage = await ctx.newPage();
  await login(clientPage, email, PASSWORD);
  await clientPage.goto("/admin/logs");
  await expect(clientPage).toHaveURL(/\/meus-agendamentos/);
  await expect(clientPage.getByRole("heading", { name: "Logs" })).toHaveCount(0);
  await ctx.close();
});

test("administradora vê as abas e os eventos reais de login recusado, login, logout e agendamento", async ({ page }, info) => {
  // 1) Tentativa recusada (senha errada) da própria conta administrativa.
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(ADMIN.email);
  await page.getByLabel("Senha").fill("senha-errada-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha incorretos")).toBeVisible();

  // 2) Login correto.
  await login(page, ADMIN.email, ADMIN.password);

  // 3) Um evento de marcação (gravado como o site grava ao confirmar uma reserva).
  const svc = await prisma.service.findFirstOrThrow({ where: { active: true } });
  const client = await prisma.user.create({
    data: { name: "Cliente Marcação", email: `logs-marc-${stamp}-${info.project.name}@example.com`, phone: "(11) 98888-2222", passwordHash: bcrypt.hashSync(PASSWORD, 10), role: "CLIENTE" },
  });
  await prisma.auditLog.create({
    data: { category: "MARCACAO", action: "booking_created", result: "SUCESSO", actorId: client.id, targetType: "Appointment", targetId: "e2e-marcacao", detail: `${svc.name} · teste` },
  });

  await page.goto("/admin");
  await page.getByRole("link", { name: "Logs" }).click();
  await expect(page).toHaveURL(/\/admin\/logs/);
  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();

  // Abas em português.
  const tabs = page.getByRole("navigation", { name: "Categorias de log" });
  for (const label of ["Cadastro", "Login", "Logout", "Marcação", "Ações administrativas", "Integrações"]) {
    await expect(tabs.getByRole("link", { name: label })).toBeVisible();
  }
  await expect(tabs.getByRole("link", { name: "Entrada" })).toHaveCount(0); // não existe esse fluxo no site
  await expect(tabs.getByRole("link", { name: "Saída" })).toHaveCount(0);

  // Login: a recusa e o login bem-sucedido, com a administradora como responsável.
  await tabs.getByRole("link", { name: "Login" }).click();
  // Pode haver mais de uma linha (outros testes também erram a senha); repetições do mesmo e-mail aparecem agrupadas ("2×").
  await expect(page.getByRole("cell", { name: /Tentativa de login recusada/ }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Login realizado" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /Admin E2E \(administradora\)/ }).first()).toBeVisible();
  await expect(page.getByText("senha-errada-123")).toHaveCount(0); // a senha nunca aparece
  await shot(page, info, "logs-login");

  // Filtro por resultado.
  await page.getByLabel("Resultado").selectOption("FALHA");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("cell", { name: /Tentativa de login recusada/ }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Login realizado" })).toHaveCount(0);

  // O filtro escolhido acompanha a troca de aba (e o formulário mostra isso): na Marcação só há sucessos, então fica vazia.
  await page.getByRole("navigation", { name: "Categorias de log" }).getByRole("link", { name: "Marcação" }).click();
  await expect(page.getByLabel("Resultado")).toHaveValue("FALHA");
  await expect(page.getByText("Nenhum registro encontrado")).toBeVisible();

  // Marcação sem filtro de resultado.
  await page.goto("/admin/logs?aba=MARCACAO");
  await expect(page.getByRole("cell", { name: "Agendamento criado" }).first()).toBeVisible();
  await expect(page.getByText("Cliente Marcação (cliente)").first()).toBeVisible();
  await shot(page, info, "logs-marcacao");

  // 4) Logout real pelo botão "Sair", novo login, e a aba Logout mostra a saída.
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/logs?aba=LOGOUT");
  await expect(page.getByRole("cell", { name: "Saída da conta (logout)" }).first()).toBeVisible();

  // Parâmetros inválidos na URL não quebram a página (caem no padrão).
  await page.goto("/admin/logs?aba=XYZ&resultado=ZZZ&pagina=-9&de=lixo&ate=lixo&usuario=%00%00");
  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  await shot(page, info, "logs-padrao");
});
