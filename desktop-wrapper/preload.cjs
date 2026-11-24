const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mobflowDesktop", Object.freeze({
  retryConnection: () => ipcRenderer.send("mobflow:retry-connection"),
  savePdf: (filename) => ipcRenderer.invoke("mobflow:save-pdf", filename),
  cacheAuthorizedSession: (session) => ipcRenderer.invoke("mobflow:cache-authorized-session", session),
  getCachedAuthorizedSession: () => ipcRenderer.invoke("mobflow:get-cached-authorized-session"),
  clearCachedAuthorizedSession: () => ipcRenderer.invoke("mobflow:clear-cached-authorized-session")
}));
