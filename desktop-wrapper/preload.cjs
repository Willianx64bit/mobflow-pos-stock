const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mobflowDesktop", Object.freeze({
  retryConnection: () => ipcRenderer.send("mobflow:retry-connection")
}));
