import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WatcherService } from './watcher'

let root: string
let service: WatcherService

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-control-watch-'))
  service = new WatcherService({ debounceMs: 35 })
})

afterEach(async () => {
  await service.close()
  rmSync(root, { recursive: true, force: true })
})

async function expectNoChange(write: () => void, changes: string[]): Promise<void> {
  write()
  await new Promise((resolve) => setTimeout(resolve, 160))
  expect(changes).toEqual([])
}

describe('WatcherService', () => {
  it('fires once after a file is created', async () => {
    const changes: string[] = []
    const file = join(root, 'created.txt')
    service.onChange(() => changes.push('changed'))
    service.watch([root])

    let attempt = 0
    await vi.waitFor(
      () => {
        if (changes.length === 0) {
          writeFileSync(file, String(attempt))
          attempt += 1
        }
        expect(changes).toEqual(['changed'])
      },
      { timeout: 5_000, interval: 120 }
    )
  })

  it('collapses rapid writes into one trailing change', async () => {
    const changes: string[] = []
    const file = join(root, 'rapid.txt')
    service.onChange(() => changes.push('changed'))
    service.watch([root])

    let attempt = 0
    await vi.waitFor(
      () => {
        if (changes.length === 0) {
          writeFileSync(file, `a-${attempt}`)
          writeFileSync(file, `b-${attempt}`)
          writeFileSync(file, `c-${attempt}`)
          attempt += 1
        }
        expect(changes).toEqual(['changed'])
      },
      { timeout: 5_000, interval: 140 }
    )
  })

  it('replaces watched paths on restart', async () => {
    const oldPath = join(root, 'old')
    const newPath = join(root, 'new')
    mkdirSync(oldPath)
    mkdirSync(newPath)

    const changes: string[] = []
    service.onChange(() => changes.push('changed'))
    service.watch([oldPath])

    let attempt = 0
    const oldFile = join(oldPath, 'before.txt')
    await vi.waitFor(
      () => {
        if (changes.length === 0) {
          writeFileSync(oldFile, String(attempt))
          attempt += 1
        }
        expect(changes).toEqual(['changed'])
      },
      { timeout: 5_000, interval: 120 }
    )

    changes.length = 0
    service.watch([newPath])
    await expectNoChange(() => writeFileSync(join(oldPath, 'ignored.txt'), 'old'), changes)

    attempt = 0
    const newFile = join(newPath, 'after.txt')
    await vi.waitFor(
      () => {
        if (changes.length === 0) {
          writeFileSync(newFile, String(attempt))
          attempt += 1
        }
        expect(changes).toEqual(['changed'])
      },
      { timeout: 5_000, interval: 120 }
    )
  })

  it('stops events after close', async () => {
    const changes: string[] = []
    service.onChange(() => changes.push('changed'))
    service.watch([root])

    let attempt = 0
    const readyFile = join(root, 'ready.txt')
    await vi.waitFor(
      () => {
        if (changes.length === 0) {
          writeFileSync(readyFile, String(attempt))
          attempt += 1
        }
        expect(changes).toEqual(['changed'])
      },
      { timeout: 5_000, interval: 120 }
    )

    changes.length = 0
    await service.close()
    await expectNoChange(() => writeFileSync(join(root, 'after-close.txt'), 'closed'), changes)
  })
})
