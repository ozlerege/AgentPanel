import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { createClaudeAdapter } from './claude'
import { createCodexAdapter } from './codex'
import { ProviderRegistry, createDefaultRegistry } from './registry'
import { encodeResourceId } from './shared/resource-id'

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

describe('claude adapter plan/validate', () => {
  const agentPath = join(FIXTURES, 'claude-user', 'agents', 'code-reviewer.md')
  const resourceId = encodeResourceId({
    provider: 'claude',
    kind: 'agents',
    scope: 'user',
    path: agentPath
  })
  const adapter = createClaudeAdapter({
    configRoot: join(FIXTURES, 'claude-user'),
    userMcpPath: join(FIXTURES, 'claude-user.json')
  })

  it('plans a form update as a single full-content write', async () => {
    const plan = await adapter.plan({
      kind: 'update',
      resourceId,
      draft: {
        provider: 'claude',
        kind: 'agents',
        scope: 'user',
        sourcePath: agentPath,
        fields: { name: 'renamed', description: 'Reviews pull requests for style issues' }
      }
    })
    expect(plan.operations).toHaveLength(1)
    expect(plan.operations[0]).toMatchObject({ kind: 'write', path: agentPath })
    expect(plan.operations[0]?.content).toContain('name: renamed')
    expect(plan.operations[0]?.content).toContain('meticulous')
  })

  it('validates planned content', async () => {
    const good = await adapter.validate({
      provider: 'claude',
      kind: 'agents',
      scope: 'user',
      sourcePath: agentPath,
      fields: {},
      raw: '---\nname: a\ndescription: b\n---\nBody\n'
    })
    expect(good).toEqual({ ok: true, diagnostics: [] })
    const bad = await adapter.validate({
      provider: 'claude',
      kind: 'agents',
      scope: 'user',
      sourcePath: agentPath,
      fields: {},
      raw: '---\nname: [broken\n---\nBody\n'
    })
    expect(bad.ok).toBe(false)
  })

  it('rejects source edits of mcp entries and non-update changes', async () => {
    const mcpId = encodeResourceId({
      provider: 'claude',
      kind: 'mcp-servers',
      scope: 'user',
      path: join(FIXTURES, 'claude-user.json'),
      entryKey: 'github'
    })
    await expect(
      adapter.plan({
        kind: 'update',
        resourceId: mcpId,
        draft: {
          provider: 'claude',
          kind: 'mcp-servers',
          scope: 'user',
          entryKey: 'github',
          fields: {},
          raw: '{}'
        }
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(adapter.plan({ kind: 'create' })).rejects.toMatchObject({
      code: 'not-implemented'
    })
  })
})

describe('codex adapter plan/validate', () => {
  const adapter = createCodexAdapter({ configRoot: join(FIXTURES, 'codex-user') })

  it('plans an mcp env form update via the shared config file', async () => {
    const configPath = join(FIXTURES, 'codex-user', 'config.toml')
    const resourceId = encodeResourceId({
      provider: 'codex',
      kind: 'mcp-servers',
      scope: 'user',
      path: configPath,
      entryKey: 'github'
    })
    const plan = await adapter.plan({
      kind: 'update',
      resourceId,
      draft: {
        provider: 'codex',
        kind: 'mcp-servers',
        scope: 'user',
        entryKey: 'github',
        sourcePath: configPath,
        fields: { command: 'bunx' }
      }
    })
    expect(plan.operations[0]?.path).toBe(configPath)
    expect(plan.operations[0]?.content).toContain('command = "bunx"')
  })
})
