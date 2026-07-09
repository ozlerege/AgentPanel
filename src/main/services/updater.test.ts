import { describe, expect, it, vi } from 'vitest'
import { scheduleAutoUpdate, shouldCheckForUpdates } from './updater'

describe('shouldCheckForUpdates', () => {
  it('allows update checks only for packaged applications', () => {
    expect(shouldCheckForUpdates(false)).toBe(false)
    expect(shouldCheckForUpdates(true)).toBe(true)
  })
})

describe('scheduleAutoUpdate', () => {
  it('does not schedule an updater request for unpackaged applications', () => {
    const log = vi.fn<(line: string) => void>()
    const checkForUpdatesAndNotify = vi.fn<() => Promise<unknown>>()
    const schedule = vi.fn<(callback: () => void, delayMs: number) => unknown>()

    scheduleAutoUpdate(log, { isPackaged: false, checkForUpdatesAndNotify, schedule })

    expect(schedule).not.toHaveBeenCalled()
    expect(checkForUpdatesAndNotify).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Auto-update check skipped: application is not packaged.')
  })

  it('logs updater failures without surfacing them', async () => {
    const log = vi.fn<(line: string) => void>()
    const checkForUpdatesAndNotify = vi.fn<() => Promise<unknown>>().mockRejectedValue(
      new Error('unsigned application')
    )
    let scheduled: (() => void) | undefined
    const schedule = vi.fn<(callback: () => void, delayMs: number) => unknown>((callback) => {
      scheduled = callback
      return undefined
    })

    scheduleAutoUpdate(log, { isPackaged: true, checkForUpdatesAndNotify, schedule })

    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 5_000)
    scheduled?.()
    await Promise.resolve()

    expect(checkForUpdatesAndNotify).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith(
      'Auto-update check failed or is unavailable: unsigned application'
    )
  })

  it('logs synchronous updater failures without throwing from the scheduled callback', () => {
    const log = vi.fn<(line: string) => void>()
    const checkForUpdatesAndNotify = vi.fn<() => Promise<unknown>>(() => {
      throw new Error('missing update configuration')
    })
    let scheduled: (() => void) | undefined

    scheduleAutoUpdate(log, {
      isPackaged: true,
      checkForUpdatesAndNotify,
      schedule: (callback) => {
        scheduled = callback
        return undefined
      }
    })

    expect(() => scheduled?.()).not.toThrow()
    expect(log).toHaveBeenCalledWith(
      'Auto-update check failed or is unavailable: missing update configuration'
    )
  })
})
