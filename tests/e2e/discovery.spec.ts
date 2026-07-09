import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { disposeRoots, launchApp, seedProject } from './launch'

async function openClaudeAgents(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Agents', exact: true })
    .nth(1)
    .click()
  await expect(page.getByRole('heading', { name: 'Claude Code Agents' })).toBeVisible()
}

test('discovers seeded resources, search and scope filters, and broken-agent diagnostics', async () => {
  const launched = await launchApp((roots) => {
    seedProject(roots)
    mkdirSync(join(roots.projectDir, '.claude', 'agents'), { recursive: true })
    writeFileSync(
      join(roots.projectDir, '.claude', 'agents', 'project-reviewer.md'),
      '---\nname: project-reviewer\ndescription: Project-only reviewer\n---\n\nReview this project.\n'
    )
  })
  try {
    await openClaudeAgents(launched.page)
    await expect(launched.page.getByRole('button', { name: /code-reviewer/ }).first()).toBeVisible()
    await expect(launched.page.getByText('User', { exact: true }).first()).toBeVisible()
    await expect(launched.page.getByRole('button', { name: /^project-reviewer/ }).first()).toBeVisible()

    await launched.page.getByRole('searchbox', { name: 'Search resources' }).fill('project-only')
    await expect(launched.page.getByRole('button', { name: /^project-reviewer/ })).toBeVisible()
    await expect(launched.page.getByRole('button', { name: /code-reviewer/ })).toHaveCount(0)
    await launched.page.getByRole('searchbox', { name: 'Search resources' }).fill('')

    await launched.page.getByRole('combobox', { name: 'Filter by scope' }).click()
    await launched.page.getByRole('option', { name: 'project' }).click()
    await expect(launched.page.getByRole('button', { name: /^project-reviewer/ })).toBeVisible()
    await expect(launched.page.getByRole('button', { name: /code-reviewer/ })).toHaveCount(0)

    await launched.page.getByRole('combobox', { name: 'Filter by scope' }).click()
    await launched.page.getByRole('option', { name: 'All scopes' }).click()
    await launched.page.getByRole('button', { name: /broken/ }).first().click()
    await expect(launched.page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible()
    await expect(launched.page.getByText(/error:/)).toBeVisible()
  } finally {
    await launched.close()
    disposeRoots(launched.roots)
  }
})
