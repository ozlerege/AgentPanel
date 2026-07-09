import { readdirSync, rmSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

const STALE_TEMP_FILE = /^\.agent-control-tmp-/

/**
 * Removes incomplete transaction temp files without following symlinked
 * directories. An unreadable directory is skipped so startup can continue.
 */
export function sweepStaleTempFiles(roots: string[]): string[] {
  const removed: string[] = []

  const visit = (directory: string): void => {
    let entries: Dirent<string>[]
    try {
      entries = readdirSync(directory, { encoding: 'utf8', withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile() || !STALE_TEMP_FILE.test(entry.name)) continue
      try {
        rmSync(path)
        removed.push(path)
      } catch {
        // A concurrent writer or inaccessible file must not block startup.
      }
    }
  }

  for (const root of roots) visit(root)
  return removed
}
