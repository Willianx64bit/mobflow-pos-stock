const { app, BrowserWindow, shell, dialog, session } = require("electron");
const path = require("node:path");

const APP_URL = "https://mobflow-pdv-gestao.vercel.app/";
const APP_ORIGIN = new URL(APP_URL).origin;

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
    // Keep receipt, PDF preview, print and app-generated blob windows inside Electron.
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

function configurePermissions() {
  const ses = session.defaultSession;

  // Camera access is restricted to the official MobFlow PDV origin.
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
    return origin === APP_ORIGIN && permission === "camera";
  });

  // Use a native Windows save dialog for downloads (exports, reports and files).
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  handleWindowOpen(win.webContents);
  win.webContents.on("did-create-window", (childWindow) => {
    childWindow.setMenuBarVisibility(false);
    handleWindowOpen(childWindow.webContents);
  });

  win.loadURL(APP_URL);
  return win;
}

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
