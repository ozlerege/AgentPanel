import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RESOURCES_CHANGED_CHANNEL } from '../shared/channels'

const source = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf8')

/**
 * The renderer is sandboxed, and sandboxed preloads cannot require()
 * external packages. electron-vite externalizes production dependencies
 * for preload builds, so any VALUE imported from a zod-bearing module
 * (like shared/ipc.ts) leaves a runtime require("zod") in the bundle and
 * kills the preload — window.api never appears and the app boots to a
 * blank page. Values shared with the preload live in shared/channels.ts,
 * which must stay dependency-free.
 */
describe('preload import hygiene', () => {
  it('imports only types from shared/ipc', () => {
    const valueImports = source
      .split('\n')
      .filter((line) => /^import (?!type\b)/.test(line) && line.includes('shared/ipc'))
    expect(valueImports).toEqual([])
  })

  it('never references zod', () => {
    expect(source).not.toMatch(/zod/)
  })

  it('uses the shared channel constant', () => {
    expect(RESOURCES_CHANGED_CHANNEL).toBe('resources:changed')
    expect(source).toContain("from '../shared/channels'")
  })
})

describe('shared/channels stays dependency-free', () => {
  it('has no imports at all', () => {
    const channels = readFileSync(
      join(import.meta.dirname, '..', 'shared', 'channels.ts'),
      'utf8'
    )
    expect(channels).not.toMatch(/^import /m)
  })
})
