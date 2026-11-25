const { app, BrowserWindow, shell, dialog, session, ipcMain, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { validateOfflineSession, isValidOfflineSessionRecord } = require("./offline-session.cjs");
const { APP_URL, APP_ORIGIN } = require("./app-config.cjs");
let mainWindow = null;
let showingOfflineFallback = false;

const OFFLINE_SESSION_FILE = "mobflow-authorized-session.bin";

function isTrustedAppSender(event) {
  try {
    return new URL(event.senderFrame?.url || "").origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function offlineSessionPath() {
  return path.join(app.getPath("userData"), OFFLINE_SESSION_FILE);
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
    return rawUrl.startsWith("blob:" + APP_ORIGIN + "/") || rawUrl.startsWith("blob:" + APP_ORIGIN);
  }
  try {
    return new URL(rawUrl).origin === APP_ORIGIN;
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
  win.loadURL(APP_URL).catch(() => showOfflineFallback(win));
}

function configurePermissions() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let origin = "";
    try {
      origin = new URL(details.requestingUrl || webContents.getURL()).origin;
    } catch {}
    const isApp = origin === APP_ORIGIN;
    const requestsCamera = permission === "camera" ||
      (permission === "media" && Array.isArray(details.mediaTypes) && details.mediaTypes.includes("video"));
    callback(Boolean(isApp && requestsCamera));
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    let origin = "";
    try {
      origin = new URL(requestingOrigin || webContents?.getURL() || "").origin;
    } catch {}
    return origin === APP_ORIGIN && (permission === "camera" || permission === "media");
  });

  ses.on("will-download", async (event, item, webContents) => {
    let sourceOrigin = "";
    try {
      sourceOrigin = new URL(webContents.getURL()).origin;
    } catch {}
    if (sourceOrigin !== APP_ORIGIN) {
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
      sandbox: true
    }
  });

  mainWindow = win;
  handleWindowOpen(win.webContents);

  let appShellLoaded = false;
  let retryingOfflineNavigation = false;

  win.webContents.on("did-finish-load", () => {
    try {
      if (new URL(win.webContents.getURL()).origin === APP_ORIGIN) {
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
      win.webContents.loadURL(APP_URL).catch(() => showOfflineFallback(win));
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

app.whenReady().then(() => {
  app.setAppUserModelId("com.mobflow.desktop");
  configurePermissions();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
