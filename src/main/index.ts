import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, dialog, shell } from 'electron'
import { RESOURCES_CHANGED_CHANNEL } from '../shared/ipc'
import { registerIpcHandlers } from './ipc/handlers'
import { createDefaultRegistry } from './providers/registry'
import { BackupService } from './services/backups'
import { openDatabase } from './services/db'
import { ExchangeService } from './services/exchange'
import { ProjectsStore } from './services/projects-store'
import { ResourceService } from './services/resources'
import { TransactionService } from './services/transactions'
import { UsageService } from './services/usage'
import { resourceWatchPaths, WatcherService } from './services/watcher'
import { applySecurityPolicy } from './security'
import { resolveConfigRoots } from './config-roots'

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']
const APP_ICON_PATH = join(app.getAppPath(), 'resources/app-icon.png')
const configRoots = resolveConfigRoots(process.env)

if (process.env['AC_USER_DATA']) app.setPath('userData', process.env['AC_USER_DATA'])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Debug aid: AC_CAPTURE=/path.png captures each screen (and both themes
  // for Overview) as /path.<screen>.png, then exits.
  const capturePath = process.env['AC_CAPTURE']
  if (capturePath) {
    win.webContents.setBackgroundThrottling(false)
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const shoot = async (name: string): Promise<void> => {
          await new Promise((resolve) => setTimeout(resolve, 400))
          const image = await win.webContents.capturePage()
          await writeFile(capturePath.replace('.png', `.${name}.png`), image.toPNG())
        }
        const clickNav = (label: string): Promise<void> =>
          win.webContents.executeJavaScript(
            `[...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`
          )
        await shoot('overview-dark')
        await win.webContents.executeJavaScript(
          "document.documentElement.classList.remove('dark')"
        )
        await shoot('overview-light')
        await win.webContents.executeJavaScript(
          "document.documentElement.classList.add('dark')"
        )
        await clickNav('Projects')
        await shoot('projects')
        await clickNav('Settings')
        await shoot('settings')
        await clickNav('Agents')
        await shoot('agents')
        await win.webContents.executeJavaScript(
          "document.querySelector('main ul button')?.click()"
        )
        await shoot('agents-selected')
        app.quit()
      }, 1500)
    })
  }

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

if (process.env['AC_CAPTURE']) app.disableHardwareAcceleration()

applySecurityPolicy(DEV_SERVER_URL)

void app.whenReady().then(() => {
  // Cosmetic only — a bad icon path (e.g. app path differs under test
  // harnesses) must never abort startup.
  if (process.platform === 'darwin') {
    try {
      app.dock?.setIcon(APP_ICON_PATH)
    } catch {
      /* keep booting without a dock icon */
    }
  }

  const db = openDatabase(join(app.getPath('userData'), 'agent-control.db'))
  const registry = createDefaultRegistry(configRoots)
  const projects = new ProjectsStore(db)
  const backups = new BackupService(db, join(app.getPath('userData'), 'backups'))
  const transactions = new TransactionService(
    {
      roots: () => [
        configRoots.codexRoot,
        configRoots.claudeRoot,
        ...projects.list().map((project) => project.path)
      ],
      files: () => [configRoots.claudeJson]
    },
    backups
  )
  const resources = new ResourceService(registry, projects, transactions, backups)
  const watcher = new WatcherService({})
  const refreshWatchedPaths = (): void =>
    watcher.watch(resourceWatchPaths(configRoots, projects.list()))
  refreshWatchedPaths()
  projects.onDidChange(refreshWatchedPaths)
  watcher.onChange(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(RESOURCES_CHANGED_CHANNEL)
    }
  })
  app.on('before-quit', () => {
    void watcher.close()
  })
  const exchange = new ExchangeService(resources, {
    async saveFile(defaultName) {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultName
      })
      return result.canceled || result.filePath === undefined ? null : result.filePath
    },
    async pickDirectory(title) {
      const result = await dialog.showOpenDialog({
        title,
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled || result.filePaths.length === 0
        ? null
        : result.filePaths[0]
    },
    async pickFile(filters) {
      const result = await dialog.showOpenDialog({
        filters,
        properties: ['openFile']
      })
      return result.canceled || result.filePaths.length === 0
        ? null
        : result.filePaths[0]
    }
  })
  registerIpcHandlers({
    backups,
    projects,
    registry,
    resources,
    exchange,
    usage: new UsageService(),
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog({
        title: 'Add project',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled || result.filePaths.length === 0
        ? null
        : result.filePaths[0]
    },
    reveal: (path) => shell.showItemInFolder(path)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
