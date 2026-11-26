import { expect, test } from "@playwright/test";
import { encodeGoogleSignup } from "../src/lib/google-login";

test("oferece Google no login e no cadastro", async ({ page }) => {
  for (const path of ["/login", "/cadastro"]) {
    await page.goto(path);
    const button = page.getByRole("button", { name: "Continuar com Google" });
    await expect(button).toBeVisible();
    await expect(button).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect.poll(() => button.locator("img").evaluate((logo) =>
      logo instanceof HTMLImageElement ? logo.naturalWidth : 0
    )).toBeGreaterThan(0);
  }
  await page.goto("/completar-cadastro");
  await expect(page).toHaveURL(/\/login$/);
});

test("oferece vínculo Google na área de uma cliente que entrou com senha", async ({ page, request }) => {
  const email = `senha-${test.info().project.name}@example.com`;
  const password = "Acesso-Cliente-E2E-43";
  const signup = await request.post("/api/auth/cadastro", {
    data: { name: "Cliente E2E", email, phone: "11912345678", password, confirmPassword: password, consent: true },
  });
  expect(signup.ok()).toBe(true);

  await page.goto("/login?callbackUrl=%2Fminha-conta");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/minha-conta$/);
  await expect(page.getByRole("button", { name: "Vincular conta Google" })).toBeVisible();
});

test("completa o cadastro e abre o destino como cliente autenticado", async ({ page, context, baseURL }) => {
  const suffix = test.info().project.name;
  // Simula a saída da verificação do Google. Cookie, formulário, NextAuth e banco usam a implementação real.
  const pending = await encodeGoogleSignup({
    sub: `google-e2e-${suffix}`,
    email: `google-${suffix}@example.com`,
    email_verified: true,
    name: "Cliente Google E2E",
  }, "/minha-conta");
  await context.addCookies([{ name: "google-signup", value: pending, url: baseURL!, httpOnly: true }]);

  await page.goto("/completar-cadastro");
  await page.getByLabel("WhatsApp / celular com DDD").fill("11912345678");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Concluir cadastro" }).click();

  await expect(page).toHaveURL(/\/minha-conta$/);
  await expect(page.getByText("Você entra nesta conta com o Google.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vincular conta Google" })).toHaveCount(0);
  expect((await context.cookies()).some((cookie) => cookie.name === "google-signup")).toBe(false);
});
