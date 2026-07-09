import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { createClaudeAdapter } from './claude'
import { createCodexAdapter } from './codex'
import { ProviderRegistry, createDefaultRegistry } from './registry'
import { encodeResourceId } from './shared/resource-id'
import { readTextFile } from './shared/scan'

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

  it('advertises codex create scopes per category', () => {
    const categories = createCodexAdapter().capabilities().categories
    expect(categories.find((c) => c.id === 'agents')?.createScopes).toEqual(['user'])
    expect(categories.find((c) => c.id === 'skills')?.createScopes).toEqual(['user'])
    expect(categories.find((c) => c.id === 'mcp-servers')?.createScopes).toEqual(['user'])
    expect(categories.find((c) => c.id === 'instructions')?.createScopes).toEqual([
      'user',
      'project'
    ])
  })

  it('advertises claude create scopes per category', () => {
    const categories = createClaudeAdapter().capabilities().categories
    for (const id of ['agents', 'skills', 'commands', 'mcp-servers', 'instructions']) {
      expect(categories.find((c) => c.id === id)?.createScopes).toEqual(['user', 'project'])
    }
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
    expect(count('agents')).toBe(4)
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
    expect(count('agents')).toBe(5)
    expect(count('skills')).toBe(4)
    expect(count('commands')).toBe(5)
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
    const registry = createDefaultRegistry({
      codexRoot: join(FIXTURES, 'codex-user'),
      claudeRoot: join(FIXTURES, 'claude-user'),
      claudeJson: join(FIXTURES, 'claude-user.json')
    })
    expect(registry.all().map((adapter) => adapter.id)).toEqual(['codex', 'claude'])
  })

  it('throws for an unknown provider id', () => {
    expect(() => new ProviderRegistry().get('codex')).toThrowError(AppOperationError)
  })
})

describe('claude adapter plan/validate', () => {
  const agentPath = join(FIXTURES, 'claude-user', 'agents', 'code-reviewer.md')
  const disabledAgentPath = join(FIXTURES, 'claude-user', 'agents', 'off.md.disabled')
  const commandPath = join(FIXTURES, 'claude-user', 'commands', 'deploy.md')
  const userMcpPath = join(FIXTURES, 'claude-user.json')
  const resourceId = encodeResourceId({
    provider: 'claude',
    kind: 'agents',
    scope: 'user',
    path: agentPath
  })
  const adapter = createClaudeAdapter({
    configRoot: join(FIXTURES, 'claude-user'),
    userMcpPath
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

  it('rejects source edits of mcp entries and malformed creates', async () => {
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
      code: 'invalid-request'
    })
  })

  it('plans claude creates for file kinds and user/project MCP entries', async () => {
    const agent = await adapter.plan({
      kind: 'create',
      draft: {
        provider: 'claude',
        kind: 'agents',
        scope: 'project',
        sourcePath: join(existingRoot, '.claude', 'agents', 'new-agent.md'),
        name: 'New Agent',
        fields: { description: 'Reviews' },
        body: 'Agent body.\n'
      }
    })
    expect(agent.operations[0]).toMatchObject({
      kind: 'write',
      path: join(existingRoot, '.claude', 'agents', 'new-agent.md')
    })
    expect(agent.operations[0]?.content).toContain('name: New Agent')

    const command = await adapter.plan({
      kind: 'create',
      draft: {
        provider: 'claude',
        kind: 'commands',
        scope: 'user',
        name: 'Deploy Now',
        fields: { description: 'Deploys now' },
        body: 'deploy\n'
      }
    })
    expect(command.operations[0]).toMatchObject({
      kind: 'write',
      path: join(FIXTURES, 'claude-user', 'commands', 'deploy-now.md')
    })
    expect(command.operations[0]?.content).toBe(
      '---\ndescription: Deploys now\n---\n\ndeploy\n'
    )

    const mcp = await adapter.plan({
      kind: 'create',
      draft: {
        provider: 'claude',
        kind: 'mcp-servers',
        scope: 'project',
        sourcePath: join(existingRoot, '.mcp.json'),
        name: 'local',
        fields: { command: 'bunx' }
      }
    })
    expect(mcp.operations).toEqual([
      {
        kind: 'write',
        path: join(existingRoot, '.mcp.json'),
        content: '{\n  "mcpServers": {\n    "local": {\n      "command": "bunx"\n    }\n  }\n}'
      }
    ])
  })

  it('plans claude duplicate, delete, and set-enabled operations', async () => {
    const duplicateAgent = await adapter.plan({
      kind: 'duplicate',
      resourceId,
      newName: 'Reviewer Copy'
    })
    expect(duplicateAgent.operations[0]).toMatchObject({
      kind: 'write',
      path: join(FIXTURES, 'claude-user', 'agents', 'reviewer-copy.md')
    })
    expect(duplicateAgent.operations[0]?.content).toContain('name: Reviewer Copy')

    const commandId = encodeResourceId({
      provider: 'claude',
      kind: 'commands',
      scope: 'user',
      path: commandPath,
      entryKey: 'deploy'
    })
    const duplicateCommand = await adapter.plan({
      kind: 'duplicate',
      resourceId: commandId,
      newName: 'Deploy Copy'
    })
    expect(duplicateCommand.operations[0]).toMatchObject({
      kind: 'write',
      path: join(FIXTURES, 'claude-user', 'commands', 'deploy-copy.md')
    })
    expect(duplicateCommand.operations[0]?.content).toBe(readTextFile(commandPath))

    const deleteAgent = await adapter.plan({ kind: 'delete', resourceId })
    expect(deleteAgent.operations).toEqual([{ kind: 'delete', path: agentPath }])

    expect(await adapter.plan({ kind: 'set-enabled', resourceId, enabled: false })).toEqual({
      operations: [{ kind: 'move', path: agentPath, toPath: `${agentPath}.disabled` }]
    })

    const disabledId = encodeResourceId({
      provider: 'claude',
      kind: 'agents',
      scope: 'user',
      path: disabledAgentPath
    })
    expect(await adapter.plan({ kind: 'set-enabled', resourceId: disabledId, enabled: true })).toEqual({
      operations: [
        {
          kind: 'move',
          path: disabledAgentPath,
          toPath: join(FIXTURES, 'claude-user', 'agents', 'off.md')
        }
      ]
    })
  })
})

describe('codex adapter plan/validate', () => {
  const adapter = createCodexAdapter({ configRoot: join(FIXTURES, 'codex-user') })
  const agentPath = join(FIXTURES, 'codex-user', 'agents', 'reviewer.toml')
  const disabledAgentPath = join(FIXTURES, 'codex-user', 'agents', 'off.toml.disabled')
  const configPath = join(FIXTURES, 'codex-user', 'config.toml')

  it('plans an mcp env form update via the shared config file', async () => {
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

  it('plans codex creates for agents, skills, instructions, and mcp entries', async () => {
    const agent = await adapter.plan({
      kind: 'create',
      draft: {
        provider: 'codex',
        kind: 'agents',
        scope: 'user',
        name: 'New Agent',
        fields: { description: 'Reviews', developer_instructions: 'Be careful.' }
      }
    })
    expect(agent.operations).toEqual([
      {
        kind: 'write',
        path: join(FIXTURES, 'codex-user', 'agents', 'new-agent.toml'),
        content:
          'name = "New Agent"\ndescription = "Reviews"\ndeveloper_instructions = "Be careful."\n'
      }
    ])

    const skill = await adapter.plan({
      kind: 'create',
      draft: {
        provider: 'codex',
        kind: 'skills',
        scope: 'user',
        name: 'New Skill',
        fields: { description: 'Does skill work' },
        body: 'Skill body.\n'
      }
    })
    expect(skill.operations[0]).toMatchObject({
      kind: 'write',
      path: join(FIXTURES, 'codex-user', 'skills', 'new-skill', 'SKILL.md')
    })
    expect(skill.operations[0]?.content).toContain('name: New Skill')

    const instructions = await adapter.plan({
      kind: 'create',
      draft: {
        provider: 'codex',
        kind: 'instructions',
        scope: 'project',
        projectId: 'project-1',
        sourcePath: join(existingRoot, 'AGENTS.md'),
        name: 'AGENTS.md',
        fields: {},
        body: 'Project instructions\n'
      }
    })
    expect(instructions.operations).toEqual([
      {
        kind: 'write',
        path: join(existingRoot, 'AGENTS.md'),
        content: 'Project instructions\n'
      }
    ])

    const mcp = await adapter.plan({
      kind: 'create',
      draft: {
        provider: 'codex',
        kind: 'mcp-servers',
        scope: 'user',
        name: 'new_server',
        fields: { command: 'bunx', args: ['-y', 'server'] }
      }
    })
    expect(mcp.operations[0]?.path).toBe(configPath)
    expect(mcp.operations[0]?.content).toContain('[mcp_servers.new_server]')
  })

  it('plans codex duplicates and delete operations', async () => {
    const agentId = encodeResourceId({
      provider: 'codex',
      kind: 'agents',
      scope: 'user',
      path: agentPath
    })
    const duplicateAgent = await adapter.plan({
      kind: 'duplicate',
      resourceId: agentId,
      newName: 'Reviewer Copy'
    })
    expect(duplicateAgent.operations[0]).toMatchObject({
      kind: 'write',
      path: join(FIXTURES, 'codex-user', 'agents', 'reviewer-copy.toml')
    })
    expect(duplicateAgent.operations[0]?.content).toContain('name = "Reviewer Copy"')

    const skillId = encodeResourceId({
      provider: 'codex',
      kind: 'skills',
      scope: 'user',
      path: join(FIXTURES, 'codex-user', 'skills', 'deploy-helper', 'SKILL.md')
    })
    const deleteSkill = await adapter.plan({ kind: 'delete', resourceId: skillId })
    expect(deleteSkill.operations).toEqual([
      {
        kind: 'delete',
        path: join(FIXTURES, 'codex-user', 'skills', 'deploy-helper', 'SKILL.md')
      },
      { kind: 'rmdir', path: join(FIXTURES, 'codex-user', 'skills', 'deploy-helper') }
    ])

    const mcpId = encodeResourceId({
      provider: 'codex',
      kind: 'mcp-servers',
      scope: 'user',
      path: configPath,
      entryKey: 'github'
    })
    const deleteMcp = await adapter.plan({ kind: 'delete', resourceId: mcpId })
    expect(deleteMcp.operations[0]?.content).not.toContain('[mcp_servers.github]')
  })

  it('plans codex enable and disable moves and rejects unsupported combinations', async () => {
    const activeId = encodeResourceId({
      provider: 'codex',
      kind: 'agents',
      scope: 'user',
      path: agentPath
    })
    await expect(adapter.plan({ kind: 'set-enabled', resourceId: activeId, enabled: true })).rejects.toMatchObject({
      code: 'invalid-request'
    })
    expect(
      await adapter.plan({ kind: 'set-enabled', resourceId: activeId, enabled: false })
    ).toEqual({
      operations: [{ kind: 'move', path: agentPath, toPath: `${agentPath}.disabled` }]
    })

    const disabledId = encodeResourceId({
      provider: 'codex',
      kind: 'agents',
      scope: 'user',
      path: disabledAgentPath
    })
    expect(
      await adapter.plan({ kind: 'set-enabled', resourceId: disabledId, enabled: true })
    ).toEqual({
      operations: [
        {
          kind: 'move',
          path: disabledAgentPath,
          toPath: join(FIXTURES, 'codex-user', 'agents', 'off.toml')
        }
      ]
    })

    await expect(
      adapter.plan({
        kind: 'duplicate',
        resourceId: encodeResourceId({
          provider: 'codex',
          kind: 'instructions',
          scope: 'user',
          path: join(FIXTURES, 'codex-user', 'AGENTS.md')
        }),
        newName: 'Copy'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
  })
})
