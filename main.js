require('dotenv').config();

const { app, BrowserWindow, ipcMain, Menu, dialog, Tray, nativeImage } = require('electron');
const path = require('path');
const { startServer, stopServer, getLocalIp } = require('./server');
const { initDatabase, getSettings, updateSetting, getUpcomingAppointments } = require('./database');

let mainWindow;
let server;
let tray = null;
let serverInfo = { port: 3456, ip: 'localhost' };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    title: 'Friseur Terminverwaltung',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const menuTemplate = [
    {
      label: 'Friseur',
      submenu: [
        { role: 'about', label: 'Über Friseur Terminverwaltung' },
        { type: 'separator' },
        { label: 'Einstellungen', accelerator: 'Cmd+,', click: () => mainWindow?.webContents.send('navigate', 'settings') },
        { type: 'separator' },
        { role: 'hide', label: 'Ausblenden' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { label: 'Dashboard', accelerator: 'Cmd+1', click: () => mainWindow?.webContents.send('navigate', 'dashboard') },
        { label: 'Kalender', accelerator: 'Cmd+2', click: () => mainWindow?.webContents.send('navigate', 'calendar') },
        { label: 'Kunden', accelerator: 'Cmd+3', click: () => mainWindow?.webContents.send('navigate', 'customers') },
        { label: 'Dienstleistungen', accelerator: 'Cmd+4', click: () => mainWindow?.webContents.send('navigate', 'services') },
        { label: 'Statistiken', accelerator: 'Cmd+5', click: () => mainWindow?.webContents.send('navigate', 'statistics') },
        { label: 'Einstellungen', accelerator: 'Cmd+6', click: () => mainWindow?.webContents.send('navigate', 'settings') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Fenster',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  initDatabase();
  server = await startServer(3456);
  
  serverInfo = { port: 3456, ip: getLocalIp() };
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopServer();
});

ipcMain.handle('get-server-info', () => serverInfo);

ipcMain.handle('get-settings', () => getSettings());
ipcMain.handle('update-setting', (event, { key, value }) => {
  updateSetting(key, value);
  return { ok: true };
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('get-upcoming', () => getUpcomingAppointments());
