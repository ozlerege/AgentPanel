import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { createClaudeAdapter } from '../providers/claude'
import { createCodexAdapter } from '../providers/codex'
import { ProviderRegistry } from '../providers/registry'
import { encodeResourceId } from '../providers/shared/resource-id'
import { openDatabase } from './db'
import { ProjectsStore } from './projects-store'
import { ResourceService } from './resources'

const FIXTURES = join(import.meta.dirname, '../../../tests/fixtures/discovery')

let service: ResourceService
let projectId: string

beforeEach(() => {
  const registry = new ProviderRegistry()
  registry.register(createCodexAdapter({ configRoot: join(FIXTURES, 'codex-user') }))
  registry.register(
    createClaudeAdapter({
      configRoot: join(FIXTURES, 'claude-user'),
      userMcpPath: join(FIXTURES, 'claude-user.json')
    })
  )
  const projects = new ProjectsStore(openDatabase(':memory:'))
  projectId = projects.add(join(FIXTURES, 'project')).id
  service = new ResourceService(registry, projects)
})

describe('ResourceService.list', () => {
  it('lists every discovered resource with no query', async () => {
    expect(await service.list({})).toHaveLength(25)
  })

  it('filters by provider, kind, scope, and project', async () => {
    expect(await service.list({ providerId: 'codex' })).toHaveLength(9)
    expect(await service.list({ kind: 'agents' })).toHaveLength(7)
    expect(await service.list({ scope: 'project' })).toHaveLength(6)
    expect(await service.list({ projectId })).toHaveLength(6)
    expect(
      await service.list({
        providerId: 'claude',
        kind: 'mcp-servers',
        scope: 'user'
      })
    ).toHaveLength(2)
  })

  it('returns summaries without fields or native content', async () => {
    const summaries = await service.list({ providerId: 'codex', kind: 'agents' })
    expect(summaries[0]).not.toHaveProperty('fields')
    expect(summaries[0]).not.toHaveProperty('native')
    expect(summaries[0]?.diagnostics).toBeDefined()
    expect(summaries[0]?.modifiedAt).toBeDefined()
  })
})

describe('ResourceService.read', () => {
  it('round-trips an id from list', async () => {
    const summaries = await service.list({
      providerId: 'claude',
      kind: 'agents',
      scope: 'user'
    })
    const target = summaries.find((summary) => summary.name === 'code-reviewer')
    if (!target) throw new Error('fixture agent not found in list')
    const doc = await service.read(target.id)
    expect(doc.fields['model']).toBe('sonnet')
    expect(doc.native.raw).toContain('meticulous')
  })

  it('rejects a forged id pointing outside discovered resources', async () => {
    const forged = encodeResourceId({
      provider: 'claude',
      kind: 'agents',
      scope: 'user',
      path: '/etc/passwd'
    })
    await expect(service.read(forged)).rejects.toSatisfy(
      (error: unknown) => error instanceof AppOperationError && error.code === 'not-found'
    )
  })

  it('rejects a malformed id', async () => {
    await expect(service.read('not-a-real-id')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppOperationError && error.code === 'invalid-request'
    )
  })
})
