const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const APP_URL = "https://mobflow-pos-stock.lovable.app";
function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 940, minWidth: 980, minHeight: 680,
    title: "MobFlow", icon: path.join(__dirname, "resources", "icon.png"),
    autoHideMenuBar: true, backgroundColor: "#f5f7f8",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url);
    }
  });
  win.loadURL(APP_URL);
}
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
