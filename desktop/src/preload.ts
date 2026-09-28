import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  quit: () => ipcRenderer.send("app:quit"),
  minimize: () => ipcRenderer.send("app:minimize"),
  maximize: () => ipcRenderer.send("app:maximize"),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateAvailable: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("update-available", handler);
    return () => { ipcRenderer.removeListener("update-available", handler); };
  },
  onUpdateDownloaded: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("update-downloaded", handler);
    return () => { ipcRenderer.removeListener("update-downloaded", handler); };
  },
});
