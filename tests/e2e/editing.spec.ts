import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { CLAUDE_AGENT, disposeRoots, launchApp, snapshotFiles } from './launch'

async function openClaudeAgents(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Agents', exact: true })
    .nth(1)
    .click()
  await expect(page.getByRole('heading', { name: 'Claude Code Agents' })).toBeVisible()
}

async function openCodeReviewer(page: Page): Promise<void> {
  await page.getByRole('button', { name: /code-reviewer/ }).first().click()
  await expect(page.getByRole('heading', { name: 'code-reviewer' })).toBeVisible()
}

async function applyEditorPreview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Review & save' }).click()
  await expect(page.getByRole('dialog', { name: 'Review changes' })).toBeVisible()
  await page.getByRole('button', { name: 'Apply changes' }).click()
}

test('edits a Claude agent form, previews the diff, and changes only its file', async () => {
  const launched = await launchApp()
  const target = join(launched.roots.claudeRoot, 'agents', 'code-reviewer.md')
  const beforeCodex = snapshotFiles(launched.roots.codexRoot)
  const beforeClaude = snapshotFiles(launched.roots.claudeRoot, [target])
  try {
    await openClaudeAgents(launched.page)
    await openCodeReviewer(launched.page)
    await launched.page.getByRole('button', { name: 'Edit' }).click()
    await launched.page.getByLabel('Description').fill('Reviews accessibility and release quality')
    await launched.page.getByRole('button', { name: 'Review & save' }).click()
    await expect(launched.page.getByRole('dialog', { name: 'Review changes' })).toContainText(
      'Reviews accessibility and release quality'
    )
    await launched.page.getByRole('button', { name: 'Apply changes' }).click()
    await expect(launched.page.getByRole('dialog', { name: 'Changes saved' })).toBeVisible()
    await launched.page.getByRole('button', { name: 'OK' }).click()

    await expect.poll(() => existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe(
      CLAUDE_AGENT.replace('Reviews pull requests for style issues', 'Reviews accessibility and release quality')
    )
    expect(snapshotFiles(launched.roots.codexRoot)).toEqual(beforeCodex)
    expect(snapshotFiles(launched.roots.claudeRoot, [target])).toEqual(beforeClaude)
  } finally {
    await launched.close()
    disposeRoots(launched.roots)
  }
})

test('round-trips a source edit while preserving unknown frontmatter and comments', async () => {
  const launched = await launchApp()
  const target = join(launched.roots.claudeRoot, 'agents', 'code-reviewer.md')
  const updated = CLAUDE_AGENT.replace('meticulous', 'careful')
  try {
    await openClaudeAgents(launched.page)
    await openCodeReviewer(launched.page)
    await launched.page.getByRole('button', { name: 'Edit' }).click()
    await launched.page.getByRole('button', { name: 'Source' }).click()
    await launched.page.getByRole('textbox', { name: 'Source editor' }).fill(updated)
    await applyEditorPreview(launched.page)
    await expect(launched.page.getByRole('dialog', { name: 'Changes saved' })).toBeVisible()
    await launched.page.getByRole('button', { name: 'OK' }).click()

    expect(readFileSync(target, 'utf8')).toBe(updated)
    expect(readFileSync(target, 'utf8')).toContain('custom: keep-this-field')
    expect(readFileSync(target, 'utf8')).toContain('<!-- preserve-this-comment -->')
  } finally {
    await launched.close()
    disposeRoots(launched.roots)
  }
})

test('surfaces a conflict after an external modification and does not overwrite it', async () => {
  const launched = await launchApp()
  const target = join(launched.roots.claudeRoot, 'agents', 'code-reviewer.md')
  const external = `${CLAUDE_AGENT}\nExternal edit wins.\n`
  try {
    await openClaudeAgents(launched.page)
    await openCodeReviewer(launched.page)
    await launched.page.getByRole('button', { name: 'Edit' }).click()
    await launched.page.getByLabel('Description').fill('This must not replace the external edit')
    await launched.page.getByRole('button', { name: 'Review & save' }).click()
    await expect(launched.page.getByRole('dialog', { name: 'Review changes' })).toBeVisible()
    writeFileSync(target, external)
    await launched.page.getByRole('button', { name: 'Apply changes' }).click()

    await expect(launched.page.getByRole('alert')).toContainText(
      'This file changed outside Desmos Agent since you loaded it.'
    )
    expect(readFileSync(target, 'utf8')).toBe(external)
  } finally {
    await launched.close()
    disposeRoots(launched.roots)
  }
})
