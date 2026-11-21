import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseURL = process.env.MOBFLOW_PREVIEW_URL;
if (!baseURL) throw new Error("MOBFLOW_PREVIEW_URL não configurada.");

const outDir = path.resolve("artifacts");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
page.on("requestfailed", (request) => {
  failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || "request failed",
  });
});

let responseStatus = null;
let pageTitle = "";
let bodyText = "";
try {
  const response = await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60000 });
  responseStatus = response?.status() ?? null;
  await page.waitForTimeout(5000);
  pageTitle = await page.title();
  bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 12000);
  await page.screenshot({ path: path.join(outDir, "pdv-preview.png"), fullPage: true });
} finally {
  await browser.close();
}

const report = {
  url: baseURL,
  checkedAt: new Date().toISOString(),
  responseStatus,
  pageTitle,
  bodyText,
  consoleErrors,
  pageErrors,
  failedRequests,
};
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  url: report.url,
  responseStatus,
  pageTitle,
  consoleErrors,
  pageErrors,
  failedRequests,
}, null, 2));

if (responseStatus === null || responseStatus >= 400) {
  throw new Error(`Preview respondeu com HTTP ${responseStatus}.`);
}
if (pageErrors.length > 0) {
  throw new Error(`O navegador registrou ${pageErrors.length} erro(s) JavaScript.`);
}
if (!pageTitle.toLowerCase().includes("mobflow")) {
  throw new Error(`Título inesperado ou aplicação não carregada: "${pageTitle}".`);
}
