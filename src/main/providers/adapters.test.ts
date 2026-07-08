import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { createClaudeAdapter } from './claude'
import { createCodexAdapter } from './codex'
import { ProviderRegistry, createDefaultRegistry } from './registry'

let existingRoot: string

beforeEach(() => {
  existingRoot = mkdtempSync(join(tmpdir(), 'agent-control-provider-'))
})

afterEach(() => {
  rmSync(existingRoot, { recursive: true, force: true })
})

describe('provider adapters', () => {
  it('detects a provider when its config root exists', async () => {
    const adapter = createCodexAdapter({ configRoot: existingRoot })
    expect(await adapter.detect()).toEqual({
      id: 'codex',
      displayName: 'Codex',
      detected: true,
      configRoot: existingRoot
    })
  })

  it('reports not detected when the config root is missing', async () => {
    const missing = join(existingRoot, 'nope')
    const adapter = createClaudeAdapter({ configRoot: missing })
    expect(await adapter.detect()).toEqual({
      id: 'claude',
      displayName: 'Claude Code',
      detected: false,
      configRoot: null
    })
  })

  it('exposes provider-honest categories (commands are Claude-only)', () => {
    const codexCategories = createCodexAdapter().capabilities().categories
    const claudeCategories = createClaudeAdapter().capabilities().categories
    expect(codexCategories.map((c) => c.id)).not.toContain('commands')
    expect(claudeCategories.map((c) => c.id)).toContain('commands')
    for (const categories of [codexCategories, claudeCategories]) {
      expect(categories.map((c) => c.id)).toEqual(
        expect.arrayContaining(['agents', 'skills', 'plugins', 'hooks', 'mcp-servers', 'instructions'])
      )
    }
  })

  it('throws not-implemented for milestone 2+ operations', async () => {
    const adapter = createCodexAdapter()
    await expect(adapter.discover({ projects: [] })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppOperationError && error.code === 'not-implemented'
    )
  })
})

describe('ProviderRegistry', () => {
  it('registers and retrieves adapters by id', () => {
    const registry = new ProviderRegistry()
    const codex = createCodexAdapter()
    registry.register(codex)
    expect(registry.get('codex')).toBe(codex)
    expect(registry.all()).toEqual([codex])
  })

  it('default registry contains codex and claude', () => {
    const registry = createDefaultRegistry()
    expect(registry.all().map((a) => a.id)).toEqual(['codex', 'claude'])
  })

  it('throws for an unknown provider id', () => {
    expect(() => new ProviderRegistry().get('codex')).toThrowError(AppOperationError)
  })
})
