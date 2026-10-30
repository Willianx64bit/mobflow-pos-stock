const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const APP_URL = "https://mobflow-pos-stock.lovable.app";
const APP_ORIGIN = new URL(APP_URL).origin;

function isInternalWindowUrl(rawUrl) {
  if (rawUrl === "about:blank" || rawUrl.startsWith("data:")) return true;
  if (rawUrl.startsWith("blob:")) return rawUrl.startsWith(`blob:${APP_ORIGIN}/`) || rawUrl.startsWith(`blob:${APP_ORIGIN}`);
  try {
    return new URL(rawUrl).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function handleWindowOpen(webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    // The web app uses popup windows for receipts, PDF previews and print flows.
    // Keep app-owned pages and generated blob documents inside Electron.
    if (isInternalWindowUrl(url)) return { action: "allow" };

    // Only send genuine external web links to the user's default browser.
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });

  webContents.on("will-navigate", (event, url) => {
    if (isInternalWindowUrl(url)) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url).catch(() => {});
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: "MobFlow",
    icon: path.join(__dirname, "resources", "icon.png"),
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
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
