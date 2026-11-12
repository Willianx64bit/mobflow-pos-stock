import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseURL = process.env.MOBFLOW_PREVIEW_URL;
const username = process.env.MOBFLOW_TEST_USERNAME;
const password = process.env.MOBFLOW_TEST_PASSWORD;
const cnpj = (process.env.MOBFLOW_TEST_CNPJ || "").replace(/\D/g, "");
if (!baseURL || !username || !password || cnpj.length !== 14) {
  throw new Error("Configure MOBFLOW_TEST_USERNAME, MOBFLOW_TEST_PASSWORD e MOBFLOW_TEST_CNPJ (14 dígitos) nos GitHub Actions Secrets.");
}

const outDir = path.resolve("artifacts");
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const loginResponses = [];

page.on("console", message => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
});
page.on("pageerror", error => pageErrors.push((error.stack || error.message).slice(0, 1000)));
page.on("response", async response => {
  if (!response.url().includes("/api/mobflow/login")) return;
  let responseMessage = "";
  try {
    const body = await response.json();
    responseMessage = String(body?.error || body?.message || (body?.ok ? "ok" : "")).slice(0, 300);
  } catch {}
  loginResponses.push({ status: response.status(), message: responseMessage });
});

try {
  const response = await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!response || response.status() >= 400) {
    throw new Error("Preview HTTP " + (response?.status() ?? "sem resposta"));
  }

  // O login de empresa já reúne usuário gerente, senha e CNPJ na mesma tela.
  await page.locator('input[name="company-login"]').waitFor({ state: "visible", timeout: 30000 });
  await page.locator('input[name="company-login"]').fill(username);
  await page.locator('input[name="company-password"]').fill(password);
  await page.locator('input[name="cnpj"]').fill(cnpj);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  await page.waitForFunction(() => localStorage.getItem("mobflow-authenticated") === "1", { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(1200);

  const authState = await page.evaluate(() => ({
    authenticated: localStorage.getItem("mobflow-authenticated") === "1",
    role: sessionStorage.getItem("mobflow-role"),
    username: sessionStorage.getItem("mobflow-username"),
    path: location.pathname
  }));
  const visibleText = (await page.locator("body").innerText()).slice(0, 1500);
  await page.screenshot({ path: path.join(outDir, "pdv-authenticated-preview.png"), fullPage: true });

  const result = {
    url: page.url(),
    title: await page.title(),
    authenticated: authState.authenticated,
    role: authState.role,
    usernameMatched: Boolean(authState.username && authState.username.toLowerCase() === username.toLowerCase()),
    loginResponses,
    visibleText,
    consoleErrors,
    pageErrors
  };
  fs.writeFileSync(path.join(outDir, "auth-report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  if (!authState.authenticated) {
    throw new Error("Login de empresa não confirmado. Verifique loginResponses e visibleText no artefato.");
  }
  if (authState.role !== "manager") {
    throw new Error("A sessão foi criada, mas o perfil autenticado não é gerente.");
  }
  if (!authState.username || authState.username.toLowerCase() !== username.toLowerCase()) {
    throw new Error("A sessão não corresponde ao usuário de teste informado.");
  }
  if (pageErrors.length) throw new Error("Foram registrados erros JavaScript durante o login.");
} finally {
  await browser.close();
}
