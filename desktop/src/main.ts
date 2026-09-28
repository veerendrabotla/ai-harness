import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, type NativeImage } from "electron";
import path from "node:path";
import { autoUpdater } from "electron-updater";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {

const isDev = !app.isPackaged;
const FRONTEND_URL = isDev ? "http://localhost:3000" : "app://./index.html";

function getIconPath(): string {
  return path.join(__dirname, "..", "assets", "icon.png");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "AI Harness",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.loadURL(FRONTEND_URL);

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error(`[Desktop] Failed to load page (code ${code}):`, desc);
    const safe = desc.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    mainWindow?.loadURL(`data:text/html,<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>Failed to load (${code})</h1><p>${safe}</p><p style="color:#666">Check your network connection and ensure the frontend server is running.</p><button onclick="location.reload()" style="padding:8px 16px;margin-top:16px;cursor:pointer">Retry</button></body></html>`);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function createTray(): void {
  const iconPath = getIconPath();
  let trayIcon: NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch (err) {
    console.error("[Desktop] Failed to load tray icon:", err);
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("AI Harness");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    ...(isDev ? [{ label: "DevTools", click: () => { mainWindow?.webContents.openDevTools({ mode: "detach" }); } }] : []),
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", () => {
    mainWindow?.webContents.send("update-available");
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-downloaded");
  });

  autoUpdater.on("error", (error) => {
    console.error("Auto-updater error:", error);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.warn("Auto-updater check failed (may be offline or dev mode):", err.message);
  });
}

ipcMain.on("app:quit", () => {
  isQuitting = true;
  app.quit();
});

ipcMain.on("app:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.on("app:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("app:get-version", () => {
  return app.getVersion();
});

ipcMain.handle("update:install", () => {
  try {
    autoUpdater.quitAndInstall();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { success: true };
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    isQuitting = true;
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
}
