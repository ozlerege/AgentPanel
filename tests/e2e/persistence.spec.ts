import { expect, test, type Page } from '@playwright/test'
import { disposeRoots, launchApp, relaunchApp, seedProject } from './launch'

async function openClaudeAgents(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Agents', exact: true })
    .nth(1)
    .click()
  await expect(page.getByRole('heading', { name: 'Claude Code Agents' })).toBeVisible()
}

test('keeps seeded projects and backup history across a full app relaunch', async () => {
  const first = await launchApp(seedProject)
  let second: Awaited<ReturnType<typeof relaunchApp>> | undefined
  try {
    await openClaudeAgents(first.page)
    await first.page.getByRole('button', { name: /code-reviewer/ }).first().click()
    await first.page.getByRole('button', { name: 'Edit' }).click()
    await first.page.getByLabel('Description').fill('Persists a backup across restarts')
    await first.page.getByRole('button', { name: 'Review & save' }).click()
    await first.page.getByRole('button', { name: 'Apply changes' }).click()
    await expect(first.page.getByRole('dialog', { name: 'Changes saved' })).toBeVisible()
    await first.page.getByRole('button', { name: 'OK' }).click()
    await first.close()

    second = await relaunchApp(first.roots)
    await second.page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Projects', exact: true })
      .click()
    await expect(second.page.getByText('project', { exact: true })).toBeVisible()
    await second.page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'History', exact: true })
      .click()
    await expect(second.page.getByRole('heading', { name: 'History' })).toBeVisible()
    await expect(second.page.getByText('code-reviewer', { exact: true })).toBeVisible()
    await expect(second.page.getByText('update', { exact: true })).toBeVisible()
  } finally {
    if (second !== undefined) await second.close()
    else await first.close()
    disposeRoots(first.roots)
  }
})
