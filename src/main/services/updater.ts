import { app } from 'electron'
// electron-updater is CommonJS; a named import fails Node's ESM
// named-export detection at load time. Its autoUpdater export is also a
// lazy getter that constructs the updater on first access — so access it
// only inside the scheduled check, never at module scope.
import updater from 'electron-updater'

const UPDATE_CHECK_DELAY_MS = 5_000

interface AutoUpdateDependencies {
  readonly isPackaged: boolean
  readonly checkForUpdatesAndNotify: () => Promise<unknown>
  readonly schedule: (callback: () => void, delayMs: number) => unknown
}

export function shouldCheckForUpdates(isPackaged: boolean): boolean {
  return isPackaged
}

export function scheduleAutoUpdate(
  log: (line: string) => void,
  dependencies: AutoUpdateDependencies
): void {
  if (!shouldCheckForUpdates(dependencies.isPackaged)) {
    log('Auto-update check skipped: application is not packaged.')
    return
  }

  dependencies.schedule(() => {
    log('Checking for updates.')
    try {
      void dependencies.checkForUpdatesAndNotify().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        log(`Auto-update check failed or is unavailable: ${message}`)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`Auto-update check failed or is unavailable: ${message}`)
    }
  }, UPDATE_CHECK_DELAY_MS)
}

export function initAutoUpdate(log: (line: string) => void): void {
  scheduleAutoUpdate(log, {
    isPackaged: app.isPackaged,
    checkForUpdatesAndNotify: () => updater.autoUpdater.checkForUpdatesAndNotify(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs)
  })
}
