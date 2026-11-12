import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseURL = process.env.MOBFLOW_PREVIEW_URL;
const username = process.env.MOBFLOW_TEST_USERNAME;
const password = process.env.MOBFLOW_TEST_PASSWORD;
if (!baseURL || !username || !password) throw new Error("Configure MOBFLOW_TEST_USERNAME e MOBFLOW_TEST_PASSWORD nos GitHub Actions Secrets.");
const outDir = path.resolve("artifacts"); fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = []; const pageErrors = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => pageErrors.push(e.stack || e.message));
try {
  const response = await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!response || response.status() >= 400) throw new Error("Preview HTTP " + (response?.status() ?? "sem resposta"));
  await page.waitForTimeout(3000);
  const passwordField = page.locator('input[type="password"]').first();
  await passwordField.waitFor({ state: "visible", timeout: 30000 });
  const textFields = page.locator('input:not([type="password"]):visible');
  if (await textFields.count() < 1) throw new Error("Campo de usuário não encontrado.");
  await textFields.first().fill(username); await passwordField.fill(password);
  const submit = page.locator('button[type="submit"]:visible').first();
  if (await submit.count()) await submit.click();
  else { const candidate = page.getByRole("button", { name: /entrar|acessar|login|continuar/i }).first(); if (!(await candidate.count())) throw new Error("Botão de login não encontrado."); await candidate.click(); }
  await page.waitForTimeout(7000);
  const stillHasPassword = await page.locator('input[type="password"]:visible').count();
  const visibleText = (await page.locator("body").innerText()).slice(0, 10000);
  const loginError = /senha incorreta|usuário não encontrado|não foi possível entrar|credenciais inválidas|erro ao autenticar/i.test(visibleText);
  await page.screenshot({ path: path.join(outDir, "pdv-authenticated-preview.png"), fullPage: true });
  const result = { url: page.url(), title: await page.title(), authenticated: stillHasPassword === 0 && !loginError, visibleText, consoleErrors, pageErrors };
  fs.writeFileSync(path.join(outDir, "auth-report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, visibleText: visibleText.slice(0, 1500) }, null, 2));
  if (!result.authenticated) throw new Error("Login não confirmado; revisar evidências.");
  if (pageErrors.length) throw new Error("Foram registrados " + pageErrors.length + " erros JavaScript.");
} finally { await browser.close(); }
