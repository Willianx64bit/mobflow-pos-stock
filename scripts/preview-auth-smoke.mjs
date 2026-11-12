import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseURL = process.env.MOBFLOW_PREVIEW_URL;
const username = process.env.MOBFLOW_TEST_USERNAME;
const password = process.env.MOBFLOW_TEST_PASSWORD;
const cnpj = (process.env.MOBFLOW_TEST_CNPJ || "").replace(/\\D/g, "");
if (!baseURL || !username || !password || cnpj.length !== 14) {
  throw new Error("Configure MOBFLOW_TEST_USERNAME, MOBFLOW_TEST_PASSWORD e MOBFLOW_TEST_CNPJ (14 dígitos) nos GitHub Actions Secrets.");
}
const outDir = path.resolve("artifacts");
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
const pageErrors = [];
const apiResponses = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => pageErrors.push(e.stack || e.message));
page.on("response", response => {
  if (response.url().includes("/api/mobflow/login")) {
    apiResponses.push({ status: response.status(), url: new URL(response.url()).pathname });
  }
});
try {
  const response = await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!response || response.status() >= 400) throw new Error("Preview HTTP " + (response?.status() ?? "sem resposta"));
  await page.locator('input[name="company-login"]').waitFor({ state: "visible", timeout: 30000 });
  await page.locator('input[name="company-login"]').fill(username);
  await page.locator('input[name="company-password"]').fill(password);
  await page.locator('input[name="cnpj"]').fill(cnpj);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForFunction(() => localStorage.getItem("mobflow-authenticated") === "1", { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const authenticated = await page.evaluate(() => localStorage.getItem("mobflow-authenticated") === "1");
  const visibleText = (await page.locator("body").innerText()).slice(0, 10000);
  await page.screenshot({ path: path.join(outDir, "pdv-authenticated-preview.png"), fullPage: true });
  const result = {
    url: page.url(),
    title: await page.title(),
    authenticated,
    loginApiResponses: apiResponses,
    visibleText: visibleText.slice(0, 1500),
    consoleErrors,
    pageErrors
  };
  fs.writeFileSync(path.join(outDir, "auth-report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!authenticated) throw new Error("Login não confirmado. Consulte auth-report.json e a captura; nenhum dado operacional foi alterado.");
  if (pageErrors.length) throw new Error("Foram registrados " + pageErrors.length + " erros JavaScript.");
} finally {
  await browser.close();
}
