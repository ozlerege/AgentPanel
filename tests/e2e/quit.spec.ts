import { expect, test } from '@playwright/test'
import { disposeRoots, launchApp } from './launch'

test('quits cleanly while resource watchers are active', async () => {
  const launched = await launchApp()
  const closed = new Promise<void>((resolve) => launched.app.once('close', resolve))

  try {
    void launched.app.evaluate(({ app }) => app.quit()).catch(() => undefined)

    const didClose = await Promise.race([
      closed.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000))
    ])
    expect(didClose).toBe(true)
  } finally {
    await launched.close().catch(() => undefined)
    disposeRoots(launched.roots)
  }
})
