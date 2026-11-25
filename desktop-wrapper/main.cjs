const { app, BrowserWindow, shell, dialog, session, ipcMain, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { validateOfflineSession, isValidOfflineSessionRecord } = require("./offline-session.cjs");
const { APP_ORIGIN } = require("./app-config.cjs");
const { createLocalRuntimeServer } = require("./local-runtime.cjs");
let mainWindow = null;
let showingOfflineFallback = false;
let localRuntime = null;
let localPublicDir = null;
let localUrl = null;
let localOrigin = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

const OFFLINE_SESSION_FILE = "mobflow-authorized-session.bin";
const DESKTOP_SESSION_PARTITION = "persist:mobflow-desktop";

function isTrustedAppSender(event) {
  try {
    return Boolean(localOrigin && new URL(event.senderFrame?.url || "").origin === localOrigin);
  } catch {
    return false;
  }
}

function offlineSessionPath() {
  return path.join(app.getPath("userData"), OFFLINE_SESSION_FILE);
}

async function verifyPackagedWebRuntime() {
  if (!localPublicDir) return false;
  try {
    const shell = await fs.stat(path.join(localPublicDir, "_shell.html"));
    if (!shell.isFile() || shell.size < 500) return false;
    let scriptCount = 0;
    const pending = [localPublicDir];
    while (pending.length) {
      const current = pending.pop();
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (/\.(?:m?js)$/i.test(entry.name)) scriptCount++;
      }
    }
    return scriptCount >= 2;
  } catch {
    return false;
  }
}

async function readAuthorizedSession() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = await fs.readFile(offlineSessionPath());
    const decoded = safeStorage.decryptString(encrypted);
    const record = JSON.parse(decoded);
    const sessionData = validateOfflineSession(record?.session);
    if (!sessionData || !isValidOfflineSessionRecord(record)) {
      await fs.rm(offlineSessionPath(), { force: true }).catch(() => {});
      return null;
    }
    return { ...sessionData, savedAt: record.savedAt };
  } catch {
    return null;
  }
}

function isInternalWindowUrl(rawUrl) {
  if (rawUrl === "about:blank" || rawUrl.startsWith("data:")) return true;
  if (rawUrl.startsWith("blob:")) {
    return Boolean(localOrigin && (rawUrl.startsWith("blob:" + localOrigin + "/") || rawUrl.startsWith("blob:" + localOrigin)));
  }
  try {
    return Boolean(localOrigin && new URL(rawUrl).origin === localOrigin);
  } catch {
    return false;
  }
}

function openExternal(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      shell.openExternal(parsed.href).catch(() => {});
    }
  } catch {}
}

function handleWindowOpen(webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalWindowUrl(url)) return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });

  webContents.on("will-navigate", (event, url) => {
    if (isInternalWindowUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
}

function showOfflineFallback(win) {
  if (win.isDestroyed() || showingOfflineFallback) return;
  showingOfflineFallback = true;
  win.loadFile(path.join(__dirname, "offline.html")).catch(() => {});
}

function loadMobFlow(win) {
  if (win.isDestroyed()) return;
  showingOfflineFallback = false;
  win.loadURL(localUrl).catch(() => showOfflineFallback(win));
}

function configurePermissions() {
  const ses = session.fromPartition(DESKTOP_SESSION_PARTITION);

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let origin = "";
    try {
      origin = new URL(details.requestingUrl || webContents.getURL()).origin;
    } catch {}
    const isApp = Boolean(localOrigin && origin === localOrigin);
    const requestsCamera = permission === "camera" ||
      (permission === "media" && Array.isArray(details.mediaTypes) && details.mediaTypes.includes("video"));
    callback(Boolean(isApp && requestsCamera));
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    let origin = "";
    try {
      origin = new URL(requestingOrigin || webContents?.getURL() || "").origin;
    } catch {}
    return Boolean(localOrigin && origin === localOrigin && (permission === "camera" || permission === "media"));
  });

  ses.on("will-download", async (event, item, webContents) => {
    let sourceOrigin = "";
    try {
      sourceOrigin = new URL(webContents.getURL()).origin;
    } catch {}
    if (!localOrigin || sourceOrigin !== localOrigin) {
      event.preventDefault();
      return;
    }

    const suggested = item.getFilename() || "download";
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(webContents), {
      title: "Salvar arquivo do MobFlow",
      defaultPath: path.join(app.getPath("downloads"), suggested),
      buttonLabel: "Salvar"
    });

    if (result.canceled || !result.filePath) {
      item.cancel();
      return;
    }
    item.setSavePath(result.filePath);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: "MobFlow",
    icon: path.join(__dirname, "resources", "icon.ico"),
    autoHideMenuBar: true,
    backgroundColor: "#f5f7f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: DESKTOP_SESSION_PARTITION
    }
  });

  mainWindow = win;
  handleWindowOpen(win.webContents);

  let appShellLoaded = false;
  let retryingOfflineNavigation = false;

  win.webContents.on("did-finish-load", () => {
    try {
      if (localOrigin && new URL(win.webContents.getURL()).origin === localOrigin) {
        appShellLoaded = true;
        retryingOfflineNavigation = false;
      }
    } catch {}
  });

  win.webContents.on("did-fail-load", (_event, errorCode, _description, _validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;

    // If this installation already opened MobFlow, do not immediately replace
    // the application with offline.html on a failed reload/navigation. Retry the
    // app origin once so its installed service worker can serve the cached shell.
    if (appShellLoaded && !retryingOfflineNavigation) {
      retryingOfflineNavigation = true;
      win.webContents.loadURL(localUrl).catch(() => showOfflineFallback(win));
      return;
    }
    showOfflineFallback(win);
  });

  win.webContents.on("did-create-window", (childWindow) => {
    childWindow.setMenuBarVisibility(false);
    handleWindowOpen(childWindow.webContents);
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    showingOfflineFallback = false;
  });

  loadMobFlow(win);
  return win;
}

ipcMain.handle("mobflow:verify-local-runtime", async (event) => {
  if (!isTrustedAppSender(event)) return false;
  return verifyPackagedWebRuntime();
});

ipcMain.handle("mobflow:save-pdf", async (event, requestedName) => {
  if (!isTrustedAppSender(event)) return false;
  const safeName = String(requestedName || "documento")
    .replace(/\.pdf$/i, "")
    .replace(/[<>:"\/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 100) || "documento";
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(ownerWindow, {
    title: "Salvar documento em PDF",
    defaultPath: path.join(app.getPath("downloads"), safeName + ".pdf"),
    buttonLabel: "Salvar",
    filters: [{ name: "Documento PDF", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) return false;
  try {
    const pdf = await event.sender.printToPDF({
      printBackground: true,
      pageSize: "A4",
      preferCSSPageSize: true,
      margins: { top: 0.25, bottom: 0.25, left: 0.25, right: 0.25 }
    });
    await fs.writeFile(result.filePath, pdf);
    return true;
  } catch (error) {
    dialog.showErrorBox("Falha ao gerar PDF", error instanceof Error ? error.message : "Não foi possível gerar o arquivo.");
    return false;
  }
});

const SAVED_LOGIN_FILE = "mobflow-saved-logins.bin";

async function readSavedLogins() {
  if (!safeStorage.isEncryptionAvailable()) return {};
  try {
    const encrypted = await fs.readFile(path.join(app.getPath("userData"), SAVED_LOGIN_FILE));
    const value = JSON.parse(safeStorage.decryptString(encrypted));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function savedLoginKey(value) {
  if (!value || typeof value !== "object") return null;
  const cnpj = String(value.cnpj || "").replace(/\\D/g, "");
  const username = String(value.username || "").trim().toLocaleLowerCase("pt-BR");
  const role = value.role === "pdv" ? "pdv" : value.role === "manager" ? "manager" : "";
  if (cnpj.length !== 14 || !username || username.length > 120 || !role) return null;
  return cnpj + ":" + role + ":" + username;
}

ipcMain.handle("mobflow:save-login-secret", async (event, value) => {
  if (!isTrustedAppSender(event) || !safeStorage.isEncryptionAvailable()) return false;
  const key = savedLoginKey(value);
  const password = typeof value?.password === "string" ? value.password : "";
  if (!key || !password || password.length > 256) return false;
  try {
    const records = await readSavedLogins();
    records[key] = { password, savedAt: Date.now() };
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(records));
    const target = path.join(app.getPath("userData"), SAVED_LOGIN_FILE);
    const temporary = target + ".tmp";
    await fs.writeFile(temporary, encrypted, { mode: 0o600 });
    await fs.rename(temporary, target);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("mobflow:get-login-secret", async (event, value) => {
  if (!isTrustedAppSender(event) || !safeStorage.isEncryptionAvailable()) return null;
  const key = savedLoginKey(value);
  if (!key) return null;
  const records = await readSavedLogins();
  const record = records[key];
  if (!record || typeof record.password !== "string" || !Number.isFinite(record.savedAt)) return null;
  return { password: record.password };
});

ipcMain.handle("mobflow:clear-login-secret", async (event, value) => {
  if (!isTrustedAppSender(event) || !safeStorage.isEncryptionAvailable()) return false;
  const key = savedLoginKey(value);
  if (!key) return false;
  try {
    const records = await readSavedLogins();
    delete records[key];
    const target = path.join(app.getPath("userData"), SAVED_LOGIN_FILE);
    if (Object.keys(records).length === 0) {
      await fs.rm(target, { force: true });
    } else {
      const encrypted = safeStorage.encryptString(JSON.stringify(records));
      const temporary = target + ".tmp";
      await fs.writeFile(temporary, encrypted, { mode: 0o600 });
      await fs.rename(temporary, target);
    }
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("mobflow:cache-authorized-session", async (event, value) => {
  if (!isTrustedAppSender(event) || !safeStorage.isEncryptionAvailable()) return false;
  const sessionData = validateOfflineSession(value);
  if (!sessionData) return false;
  try {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify({
      session: sessionData,
      savedAt: Date.now()
    }));
    await fs.writeFile(offlineSessionPath(), encrypted, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("mobflow:get-cached-authorized-session", async (event) => {
  if (!isTrustedAppSender(event)) return null;
  return readAuthorizedSession();
});

ipcMain.handle("mobflow:clear-cached-authorized-session", async (event) => {
  if (!isTrustedAppSender(event)) return false;
  await fs.rm(offlineSessionPath(), { force: true }).catch(() => {});
  return true;
});

ipcMain.on("mobflow:retry-connection", () => {
  if (mainWindow && !mainWindow.isDestroyed()) loadMobFlow(mainWindow);
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  app.setAppUserModelId("com.mobflow.desktop");
  const publicDir = app.isPackaged
    ? path.join(process.resourcesPath, "mobflow-web")
    : path.resolve(__dirname, "../.output/public");
  localPublicDir = publicDir;
  const runtimeFetch = process.env.MOBFLOW_TEST_OFFLINE === "1"
    ? async () => { throw new TypeError("Failed to fetch: simulated offline startup"); }
    : fetch;
  localRuntime = createLocalRuntimeServer({ publicDir, remoteOrigin: APP_ORIGIN, fetchImpl: runtimeFetch });
  try {
    const address = await localRuntime.listen(43173);
    localUrl = address.url;
    localOrigin = address.origin;
    if (process.env.MOBFLOW_TEST_READY_FILE) {
      await fs.writeFile(process.env.MOBFLOW_TEST_READY_FILE, JSON.stringify({ url: localUrl }), { mode: 0o600 });
    }
  } catch (error) {
    dialog.showErrorBox("MobFlow não iniciou", error instanceof Error ? error.message : "Não foi possível iniciar o aplicativo local.");
    app.quit();
    return;
  }
  configurePermissions();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  void localRuntime?.close().catch((error) => console.error("[MobFlow Desktop] Local server shutdown failed:", error));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
