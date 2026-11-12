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
const apiResponses = [];
const testName = "QA MOBFLOW CRUD " + new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const testCode = String(Date.now()).slice(-10);
let productCreated = false;
let productDeleted = false;
let createdProductId = "";
let failureMessage = "";
let editedProductEvidence = null;

page.on("console", message => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
});
page.on("pageerror", error => pageErrors.push((error.stack || error.message).slice(0, 1000)));
page.on("response", async response => {
  if (!response.url().includes("/api/mobflow/")) return;
  let message = "";
  try {
    const body = await response.json();
    message = String(body?.error || body?.message || (body?.ok ? "ok" : "")).slice(0, 300);
    if (new URL(response.url()).pathname === "/api/mobflow/products" && response.status() === 201) { createdProductId = String(body?.product?.id || ""); productCreated = Boolean(createdProductId); }
  } catch {}
  apiResponses.push({ path: new URL(response.url()).pathname, status: response.status(), message });
});

try {
  const response = await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!response || response.status() >= 400) throw new Error("Preview HTTP " + (response?.status() ?? "sem resposta"));

  await page.locator('input[name="company-login"]').waitFor({ state: "visible", timeout: 30000 });
  await page.locator('input[name="company-login"]').fill(username);
  await page.locator('input[name="company-password"]').fill(password);
  await page.locator('input[name="cnpj"]').fill(cnpj);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForFunction(() => localStorage.getItem("mobflow-authenticated") === "1", { timeout: 30000 });

  const authState = await page.evaluate(() => ({
    authenticated: localStorage.getItem("mobflow-authenticated") === "1",
    role: sessionStorage.getItem("mobflow-role"),
    username: sessionStorage.getItem("mobflow-username")
  }));
  if (!authState.authenticated || authState.role !== "manager" || !authState.username || authState.username.toLowerCase() !== username.toLowerCase()) {
    throw new Error("A sessão de Gerência não corresponde ao usuário de teste.");
  }

  // A tela Estoque exige o desbloqueio local da Gerência, além da sessão autenticada.
  await page.evaluate(() => sessionStorage.setItem("mobflow-management", "1"));
  await page.goto(new URL("/estoque", baseURL).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /\+ Produto/ }).waitFor({ state: "visible", timeout: 30000 });

  await page.getByRole("button", { name: /\+ Produto/ }).click();
  const form = page.locator("form").last();
  await form.locator("label").filter({ hasText: /^Nome$/ }).locator("input").fill(testName);
  await form.locator('input[inputmode="numeric"]').first().fill(testCode);
  await form.locator("label").filter({ hasText: "Categoria" }).locator("input").fill("QA MobFlow");
  await form.locator("label").filter({ hasText: /^Preço R\$/ }).locator("input").fill("12,34");
  await form.locator("label").filter({ hasText: /^Custo R\$/ }).locator("input").fill("5,00");
  await form.locator("label").filter({ hasText: /^Estoque$/ }).locator("input").fill("5");
  await form.locator("label").filter({ hasText: /^Mínimo$/ }).locator("input").fill("0");
  const createResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/mobflow/products" && response.request().method() === "POST", { timeout: 30000 });
  await form.getByRole("button", { name: /^Salvar/ }).click();
  const createResponse = await createResponsePromise;
  const createBody = await createResponse.json().catch(() => null);
  if (!createResponse.ok() || createBody?.ok !== true || !createBody?.product?.id) throw new Error("O cadastro não foi confirmado pela API Neon (HTTP " + createResponse.status() + ").");
  createdProductId = String(createBody.product.id);
  productCreated = true;
  await page.getByText(testName, { exact: true }).waitFor({ state: "visible", timeout: 30000 });

  // Edição via botão da própria linha da tabela.
  await page.getByRole("button", { name: "Editar " + testName }).click();
  const editForm = page.locator("form").last();
  await editForm.locator("label").filter({ hasText: /^Preço R\$/ }).locator("input").fill("13,45");
  const patchResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/mobflow/products" && response.request().method() === "PATCH", { timeout: 30000 });
  await editForm.getByRole("button", { name: /^Salvar/ }).click();
  const patchResponse = await patchResponsePromise;
  const patchBody = await patchResponse.json().catch(() => null);
  if (!patchResponse.ok() || patchBody?.ok !== true || Number(patchBody?.product?.price) !== 13.45) {
    throw new Error("A API não confirmou a edição do preço (HTTP " + patchResponse.status() + "): " + String(patchBody?.error || "resposta inválida"));
  }
  await page.getByText(testName, { exact: true }).waitFor({ state: "visible", timeout: 30000 });
  const editedProduct = await page.evaluate(async ({ id, query }) => {
    const response = await fetch("/api/mobflow/products?limit=100&q=" + encodeURIComponent(query), { credentials: "same-origin" });
    const body = await response.json();
    const product = (body.products || []).find((item) => item.id === id) || null;
    return { status: response.status, ok: response.ok && body.ok === true, error: body.error || null, product: product ? { id: product.id, price: Number(product.price), version: Number(product.version) } : null };
  }, { id: createdProductId, query: testName });
  editedProductEvidence = editedProduct;
  if (!editedProduct.ok || !editedProduct.product || editedProduct.product.price !== 13.45) {
    throw new Error("A edição foi aceita pela tela, mas não foi confirmada na consulta Neon: " + JSON.stringify(editedProduct));
  }

  // Cart, refresh and manual sync regression: do not finalize a sale or alter stock.
  await page.evaluate(() => {
    sessionStorage.setItem("mobflow-pdv-authorized", "1");
    sessionStorage.setItem("mobflow-permissions", JSON.stringify(["PDV", "Gerência"]));
  });
  await page.goto(new URL("/", baseURL).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: "Sincronizar dados" }).waitFor({ state: "visible", timeout: 30000 });
  const productCard = page.getByRole("button").filter({ hasText: testName }).first();
  await productCard.waitFor({ state: "visible", timeout: 30000 });
  await productCard.click();
  await page.locator("aside").getByText(testName, { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  const cartBeforeReload = await page.locator("aside").getByText(testName, { exact: true }).count();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: "Sincronizar dados" }).waitFor({ state: "visible", timeout: 30000 });
  const cartAfterReload = await page.locator("aside").getByText(testName, { exact: true }).count();
  const syncResponseStart = apiResponses.length;
  await page.getByRole("button", { name: "Sincronizar dados" }).click();
  await page.getByRole("status").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Sincronizar dados"]');
    return button && !button.hasAttribute("disabled") &&
      document.querySelector('[role="status"]')?.textContent?.trim() !== "Sincronizando dados...";
  }, { timeout: 30000 });
  const syncStatus = await page.locator('[role="status"]').innerText().catch(() => "");
  const syncApiResponses = apiResponses.slice(syncResponseStart);
  const cartSyncEvidence = { cartBeforeReload, cartAfterReload, syncStatus, syncApiResponses };
  if (/Sincronização não concluída/i.test(syncStatus)) {
    throw new Error("O botão de sincronização informou falha: " + syncStatus);
  }
  await page.goto(new URL("/estoque", baseURL).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /\\+ Produto/ }).waitFor({ state: "visible", timeout: 30000 });

  // Exclusão lógica do produto recém-criado, sempre com estoque 5.
  await page.getByRole("button", { name: "Editar " + testName }).click();
  const deleteForm = page.locator("form").last();
  page.once("dialog", dialog => dialog.accept());
  await deleteForm.getByRole("button", { name: "Excluir", exact: true }).click();
  await page.getByText(testName, { exact: true }).waitFor({ state: "hidden", timeout: 30000 });
  const deletedProduct = await page.evaluate(async ({ id, query }) => { const response = await fetch("/api/mobflow/products?limit=100&q=" + encodeURIComponent(query), { credentials: "same-origin" }); const body = await response.json(); if (!response.ok || body.ok !== true) throw new Error("Falha ao consultar o catálogo após exclusão (HTTP " + response.status + ")."); return (body.products || []).some((item) => item.id === id); }, { id: createdProductId, query: testName });
  if (deletedProduct) throw new Error("O produto continuou ativo no catálogo após a exclusão.");
  productDeleted = true;

  const result = {
    url: page.url(),
    authenticated: authState.authenticated,
    role: authState.role,
    usernameMatched: true,
    crud: { create: productCreated, edit: true, delete: productDeleted, testProductName: testName, stockAtDelete: 5 },
    cartSyncEvidence,
    apiResponses,
    consoleErrors,
    pageErrors
  };
  fs.writeFileSync(path.join(outDir, "auth-crud-report.json"), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(outDir, "pdv-stock-crud-preview.png"), fullPage: true });
  console.log(JSON.stringify(result, null, 2));
  if (pageErrors.length) throw new Error("Foram registrados erros JavaScript durante o teste.");
  const failedApi = apiResponses.find(x => x.path === "/api/mobflow/products" && x.status >= 400);
  if (failedApi) throw new Error("A API de produtos retornou HTTP " + failedApi.status + ": " + failedApi.message);
  const snapshotConflict = apiResponses.find(x => x.path === "/api/mobflow/state" && x.status === 409);
  if (snapshotConflict) throw new Error("Uma operação do catálogo ainda disparou conflito de snapshot app_state (HTTP 409).");
  const realtimeRejected = consoleErrors.find(x => x.includes("upstream_rejected"));
  if (realtimeRejected) throw new Error("Neon Realtime rejeitou a live query: " + realtimeRejected.slice(0, 300));
} catch (error) {
  failureMessage = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  const reportPath = path.join(outDir, "auth-crud-report.json");
  if (!fs.existsSync(reportPath)) {
    fs.writeFileSync(reportPath, JSON.stringify({ url: page.url(), authenticated: page.url().includes(baseURL), crud: { create: productCreated, edit: Boolean(editedProductEvidence), delete: productDeleted },
    cartSyncEvidence: typeof cartSyncEvidence === "undefined" ? null : cartSyncEvidence, editedProductEvidence, apiResponses, consoleErrors, pageErrors, failure: failureMessage }, null, 2));
    await page.screenshot({ path: path.join(outDir, "pdv-stock-crud-preview.png"), fullPage: true }).catch(() => undefined);
  }
  // Limpeza de segurança: se a edição/exclusão falhar, remove apenas o ID
  // retornado pelo POST desta execução; nunca procura nem altera produtos existentes.
  if (productCreated && !productDeleted && createdProductId) {
    await page.evaluate(async (id) => {
      await fetch("/api/mobflow/products", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
    }, createdProductId).catch(() => undefined);
  }
  await browser.close();
}
