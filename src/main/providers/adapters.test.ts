import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { createClaudeAdapter } from './claude'
import { createCodexAdapter } from './codex'
import { ProviderRegistry, createDefaultRegistry } from './registry'

const FIXTURES = join(import.meta.dirname, '../../../tests/fixtures/discovery')

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

  it('exposes only categories discovery serves (spec: provider honesty)', () => {
    const codexCategories = createCodexAdapter().capabilities().categories
    const claudeCategories = createClaudeAdapter().capabilities().categories
    expect(codexCategories.map((c) => c.id)).toEqual([
      'agents',
      'skills',
      'mcp-servers',
      'instructions'
    ])
    expect(claudeCategories.map((c) => c.id)).toEqual([
      'agents',
      'skills',
      'commands',
      'mcp-servers',
      'instructions'
    ])
  })

  it('throws not-implemented for milestone 3 operations', async () => {
    const adapter = createCodexAdapter()
    await expect(
      adapter.validate({
        provider: 'codex',
        kind: 'agents',
        scope: 'user',
        fields: {}
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppOperationError && error.code === 'not-implemented'
    )
  })
})

describe('adapter discovery integration', () => {
  const context = {
    projects: [{ id: 'project-1', path: join(FIXTURES, 'project') }]
  }

  it('codex adapter discovers fixture resources across kinds and scopes', async () => {
    const adapter = createCodexAdapter({ configRoot: join(FIXTURES, 'codex-user') })
    const natives = await adapter.discover(context)
    const count = (kind: string) => natives.filter((native) => native.kind === kind).length
    expect(count('agents')).toBe(3)
    expect(count('skills')).toBe(2)
    expect(count('mcp-servers')).toBe(2)
    expect(count('instructions')).toBe(2)
    expect(natives.filter((native) => native.scope === 'project')).toHaveLength(1)
    for (const native of natives) {
      const doc = await adapter.parse(native)
      expect(doc.provider).toBe('codex')
      expect(doc.kind).toBe(native.kind)
    }
  })

  it('claude adapter discovers fixture resources across kinds and scopes', async () => {
    const adapter = createClaudeAdapter({
      configRoot: join(FIXTURES, 'claude-user'),
      userMcpPath: join(FIXTURES, 'claude-user.json')
    })
    const natives = await adapter.discover(context)
    const count = (kind: string) => natives.filter((native) => native.kind === kind).length
    expect(count('agents')).toBe(4)
    expect(count('skills')).toBe(3)
    expect(count('commands')).toBe(4)
    expect(count('mcp-servers')).toBe(3)
    expect(count('instructions')).toBe(2)
    expect(natives.filter((native) => native.scope === 'project')).toHaveLength(5)
    for (const native of natives) {
      const doc = await adapter.parse(native)
      expect(doc.provider).toBe('claude')
      expect(doc.kind).toBe(native.kind)
    }
  })

  it('parse rejects an unknown resource kind', async () => {
    const adapter = createCodexAdapter({ configRoot: join(FIXTURES, 'codex-user') })
    await expect(
      adapter.parse({
        provider: 'codex',
        kind: 'plugins',
        scope: 'user',
        paths: ['/tmp/x']
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppOperationError && error.code === 'invalid-request'
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
    expect(registry.all().map((adapter) => adapter.id)).toEqual(['codex', 'claude'])
  })

  it('throws for an unknown provider id', () => {
    expect(() => new ProviderRegistry().get('codex')).toThrowError(AppOperationError)
  })
})
