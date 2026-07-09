import { expect, test } from '@playwright/test'
import { disposeRoots, launchApp } from './launch'

test('opens the app with both providers and their capability categories', async () => {
  const launched = await launchApp()
  try {
    await expect(launched.page.getByRole('heading', { name: 'Overview' })).toBeVisible()
    await expect(launched.page.getByRole('img', { name: 'Codex detected' })).toBeVisible()
    await expect(launched.page.getByRole('img', { name: 'Claude Code detected' })).toBeVisible()

    const navigation = launched.page.getByRole('navigation', { name: 'Main navigation' })
    await expect(navigation.getByRole('button', { name: 'Agents', exact: true })).toHaveCount(2)
    await expect(navigation.getByRole('button', { name: 'Skills', exact: true })).toHaveCount(2)
    await expect(navigation.getByRole('button', { name: 'MCP Servers', exact: true })).toHaveCount(2)
    await expect(navigation.getByRole('button', { name: 'Commands', exact: true })).toHaveCount(1)
  } finally {
    await launched.close()
    disposeRoots(launched.roots)
  }
})
