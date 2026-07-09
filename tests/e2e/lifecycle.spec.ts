import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { disposeRoots, launchApp } from './launch'

async function openCodexAgents(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Agents', exact: true })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Codex Agents' })).toBeVisible()
}

async function openActions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
}

async function confirmPreview(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('dialog', { name })).toBeVisible()
  await page.getByRole('button', { name: /resource$/ }).click()
}

test('creates, updates, disables, enables, deletes and restores a Codex agent with history undo', async () => {
  const launched = await launchApp()
  const agentName = 'release-captain'
  const path = join(launched.roots.codexRoot, 'agents', `${agentName}.toml`)
  const disabledPath = `${path}.disabled`
  const original = `name = "${agentName}"\ndescription = "Owns release readiness"\ndeveloper_instructions = "Ship only verified changes."\n`
  const updated = original.replace('Owns release readiness', 'Owns the release checklist')
  try {
    await openCodexAgents(launched.page)
    await launched.page.getByRole('button', { name: 'Add Agents' }).click()
    await expect(launched.page.getByRole('dialog', { name: 'Create Agents' })).toBeVisible()
    await launched.page.getByLabel('Name').fill(agentName)
    await launched.page.getByLabel('Description').fill('Owns release readiness')
    await launched.page.getByLabel('Developer instructions').fill('Ship only verified changes.')
    await launched.page.getByRole('button', { name: 'Review & create' }).click()
    await expect(launched.page.getByRole('dialog', { name: 'Review changes' })).toBeVisible()
    await launched.page.getByRole('button', { name: 'Apply changes' }).click()
    // The create flow closes its dialog and selects the new resource; only
    // the edit flow shows the "Changes saved" confirmation.
    await expect(launched.page.getByRole('dialog', { name: 'Create Agents' })).toBeHidden()
    await expect.poll(() => existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(original)

    await launched.page.getByRole('button', { name: 'Edit' }).click()
    await launched.page.getByLabel('Description').fill('Owns the release checklist')
    await launched.page.getByRole('button', { name: 'Review & save' }).click()
    await launched.page.getByRole('button', { name: 'Apply changes' }).click()
    await expect(launched.page.getByRole('dialog', { name: 'Changes saved' })).toBeVisible()
    await launched.page.getByRole('button', { name: 'OK' }).click()
    expect(readFileSync(path, 'utf8')).toBe(updated)

    await openActions(launched.page)
    await launched.page.getByRole('menuitem', { name: 'Disable' }).click()
    await confirmPreview(launched.page, `Disable ${agentName}`)
    await expect.poll(() => existsSync(disabledPath)).toBe(true)
    expect(existsSync(path)).toBe(false)
    await expect(launched.page.getByText('Disabled', { exact: true }).first()).toBeVisible()

    await launched.page.getByRole('button', { name: /release-captain/ }).first().click()
    await openActions(launched.page)
    await launched.page.getByRole('menuitem', { name: 'Enable' }).click()
    await confirmPreview(launched.page, `Enable ${agentName}`)
    await expect.poll(() => existsSync(path)).toBe(true)
    expect(existsSync(disabledPath)).toBe(false)

    await launched.page.getByRole('button', { name: /release-captain/ }).first().click()
    await openActions(launched.page)
    await launched.page.getByRole('menuitem', { name: 'Delete' }).click()
    await confirmPreview(launched.page, `Delete ${agentName}`)
    await expect.poll(() => existsSync(path)).toBe(false)
    await expect(launched.page.getByRole('dialog', { name: `Deleted ${agentName}` })).toBeVisible()
    await launched.page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(updated)

    await launched.page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'History', exact: true })
      .click()
    await expect(launched.page.getByRole('heading', { name: 'History' })).toBeVisible()
    for (const operation of ['create', 'update', 'disable', 'enable', 'delete']) {
      await expect(launched.page.getByText(operation, { exact: true }).first()).toBeVisible()
    }
    const updateEntry = launched.page.locator('li').filter({ hasText: 'update' }).filter({ hasText: agentName }).first()
    await updateEntry.getByRole('button', { name: 'Undo' }).click()
    await expect(launched.page.getByRole('dialog', { name: `Undo update of "${agentName}"?` })).toBeVisible()
    await launched.page.getByRole('dialog').getByRole('button', { name: 'Undo' }).click()
    await expect(launched.page.getByRole('status')).toContainText(`Undid update of ${agentName}`)
    expect(readFileSync(path, 'utf8')).toBe(original)
  } finally {
    await launched.close()
    disposeRoots(launched.roots)
  }
})
