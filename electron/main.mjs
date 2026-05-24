import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from "electron";
import { startClipKeepServer } from "../server.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const popoverWidth = 520;
const popoverHeight = 720;

let tray = null;
let popover = null;
let relay = null;

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("CK");
  tray.setToolTip("ClipKeep");
  tray.on("click", togglePopover);
  tray.on("right-click", () => tray.popUpContextMenu(createTrayMenu()));
  tray.setContextMenu(createTrayMenu());
}

function createTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Show ClipKeep", click: showPopover },
    { label: "Reload", click: () => popover?.reload() },
    { type: "separator" },
    { label: "Quit ClipKeep", role: "quit" }
  ]);
}

function createPopover() {
  popover = new BrowserWindow({
    width: popoverWidth,
    height: popoverHeight,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: "ClipKeep",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  popover.on("blur", () => {
    if (!popover?.webContents.isDevToolsOpened()) popover.hide();
  });

  popover.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (relay?.macUrl) {
    popover.loadURL(relay.macUrl);
  } else {
    popover.loadFile(path.join(dirname, "../dist/index.html"));
  }
}

function positionPopover() {
  if (!tray || !popover) return;
  const trayBounds = tray.getBounds();
  const display = popover.getBounds();
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - popoverWidth / 2);
  const y = Math.round(trayBounds.y + trayBounds.height + 6);
  popover.setBounds({ ...display, x, y, width: popoverWidth, height: popoverHeight });
}

function showPopover() {
  if (!popover) createPopover();
  positionPopover();
  popover.show();
  popover.focus();
}

function togglePopover() {
  if (popover?.isVisible()) {
    popover.hide();
    return;
  }
  showPopover();
}

async function start() {
  app.setName("ClipKeep");
  if (process.platform === "darwin") app.dock.hide();
  const requestedPort = process.env.PORT ? Number(process.env.PORT) : 0;
  relay = await startClipKeepServer({ port: requestedPort, log: isDev });
  createTray();
  createPopover();
}

app.whenReady().then(start);

app.on("window-all-closed", () => {});

app.on("before-quit", async () => {
  await relay?.close();
});
