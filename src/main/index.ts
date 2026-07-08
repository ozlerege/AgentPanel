import { join } from 'node:path'
import { BrowserWindow, app, dialog } from 'electron'
import { registerIpcHandlers } from './ipc/handlers'
import { createDefaultRegistry } from './providers/registry'
import { openDatabase } from './services/db'
import { ProjectsStore } from './services/projects-store'
import { applySecurityPolicy } from './security'

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

applySecurityPolicy(DEV_SERVER_URL)

void app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath('userData'), 'agent-control.db'))
  registerIpcHandlers({
    projects: new ProjectsStore(db),
    registry: createDefaultRegistry(),
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog({
        title: 'Add project',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled || result.filePaths.length === 0
        ? null
        : result.filePaths[0]
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
