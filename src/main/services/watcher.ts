import { join } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { ConfigRoots } from '../config-roots'

/**
 * The exact filesystem surfaces discovery scans — and nothing more. Provider
 * roots are never watched wholesale: ~/.codex and ~/.claude also hold session
 * logs, transcripts, and plugin caches with thousands of directories, and
 * chokidar (no fsevents since v4) opens one fs.watch handle per directory,
 * which exhausts the file-descriptor limit of GUI-launched processes.
 */
export function resourceWatchPaths(roots: ConfigRoots, projects: Array<{ path: string }>): string[] {
  return [
    join(roots.codexRoot, 'agents'),
    join(roots.codexRoot, 'skills'),
    join(roots.codexRoot, 'config.toml'),
    join(roots.codexRoot, 'AGENTS.md'),
    join(roots.claudeRoot, 'agents'),
    join(roots.claudeRoot, 'skills'),
    join(roots.claudeRoot, 'commands'),
    join(roots.claudeRoot, 'CLAUDE.md'),
    roots.claudeJson,
    ...projects.flatMap((project) => [
      join(project.path, '.claude'),
      join(project.path, 'CLAUDE.md'),
      join(project.path, 'AGENTS.md'),
      join(project.path, '.mcp.json')
    ])
  ]
}

export class WatcherService {
  private readonly debounceMs: number
  private readonly listeners = new Set<() => void>()
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private watchedKey = ''

  constructor(options: { debounceMs?: number }) {
    this.debounceMs = options.debounceMs ?? 400
  }

  watch(paths: string[]): void {
    const nextPaths = Array.from(new Set(paths)).sort()
    const nextKey = JSON.stringify(nextPaths)
    if (nextKey === this.watchedKey) return

    this.generation += 1
    this.watchedKey = nextKey
    this.clearTimer()

    const previous = this.watcher
    this.watcher = null
    if (previous) void previous.close()
    if (nextPaths.length === 0) return

    const generation = this.generation
    const watcher = watch(nextPaths, {
      ignoreInitial: true,
      persistent: false,
      usePolling: process.env['NODE_ENV'] === 'test',
      interval: 50
    })
    watcher.on('all', () => this.scheduleChange(generation))
    watcher.on('error', () => undefined)
    this.watcher = watcher
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async close(): Promise<void> {
    this.generation += 1
    this.watchedKey = ''
    this.clearTimer()

    const watcher = this.watcher
    this.watcher = null
    if (watcher) await watcher.close()
  }

  private scheduleChange(generation: number): void {
    if (generation !== this.generation) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      if (generation !== this.generation) return
      for (const listener of this.listeners) listener()
    }, this.debounceMs)
  }

  private clearTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}
