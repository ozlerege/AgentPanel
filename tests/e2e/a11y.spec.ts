import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import type { AxeResults } from 'axe-core'
import { disposeRoots, launchApp } from './launch'

// @axe-core/playwright's analyze() opens a sidecar page, which Electron
// browser contexts do not support — inject axe-core into the app page
// instead (CDP evaluation is not subject to the app's CSP).
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
)

async function expectNoSeriousOrCriticalViolations(page: Page, surface: string): Promise<void> {
  // Kill CSS transitions/animations before scanning: axe's color-contrast
  // rule otherwise samples mid-transition blended colors (async data loads
  // re-render buttons and restart their transition-colors at any moment).
  // Settled colors are still measured, so real violations still fail.
  await page.addStyleTag({
    content:
      '*, *::before, *::after { transition: none !important; animation: none !important; }'
  })
  await page.evaluate(axeSource)
  const results = await page.evaluate<AxeResults>(
    `axe.run(document, { resultTypes: ['violations'] })`
  )
  const blockingViolations = results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target.join(' '),
        html: node.html,
        failureSummary: node.failureSummary
      }))
    }))
  expect(blockingViolations, `axe violations on ${surface}`).toEqual([])
}

async function openCodexAgents(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Agents', exact: true })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Codex Agents' })).toBeVisible()
}

test('has no serious or critical axe violations on primary app surfaces', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
    await expectNoSeriousOrCriticalViolations(page, 'overview')

    await openCodexAgents(page)
    await expectNoSeriousOrCriticalViolations(page, 'codex agents list')

    await page.getByRole('button', { name: /reviewer/ }).first().click()
    await expect(page.getByRole('heading', { name: 'reviewer' })).toBeVisible()
    await expectNoSeriousOrCriticalViolations(page, 'inspector view')

    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByRole('button', { name: 'Review & save' })).toBeVisible()
    await expectNoSeriousOrCriticalViolations(page, 'inspector edit')
    await page.getByRole('button', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: 'Add Agents' }).click()
    await expect(page.getByRole('dialog', { name: 'Create Agents' })).toBeVisible()
    await expectNoSeriousOrCriticalViolations(page, 'create dialog')
    await page.getByRole('dialog', { name: 'Create Agents' }).getByRole('button', { name: 'Cancel' }).click()

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'History', exact: true })
      .click()
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
    await expectNoSeriousOrCriticalViolations(page, 'history')

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Settings', exact: true })
      .click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expectNoSeriousOrCriticalViolations(page, 'settings')
  } finally {
    await launched.close()
    disposeRoots(launched.roots)
  }
})

test('keyboard navigation selects a resource and opens then closes its actions menu', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await openCodexAgents(page)
    const scopeFilter = page.getByRole('combobox', { name: 'Filter by scope' })
    const reviewer = page.getByRole('button', { name: /reviewer/ }).first()
    const rowActions = page.getByRole('button', { name: 'Actions for reviewer' })

    await scopeFilter.focus()
    await page.keyboard.press('Tab')
    await expect(reviewer).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'reviewer' })).toBeVisible()

    await page.keyboard.press('Tab')
    await expect(rowActions).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()
    await expect(rowActions).toBeFocused()
  } finally {
    await launched.close()
    disposeRoots(launched.roots)
  }
})
