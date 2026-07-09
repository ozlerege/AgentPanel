import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ResourceDocument, ResourceMutation } from '../../shared/resource'
import { AppOperationError } from '../errors'
import { createClaudeAdapter } from '../providers/claude'
import { createCodexAdapter } from '../providers/codex'
import { ProviderRegistry } from '../providers/registry'
import { encodeResourceId } from '../providers/shared/resource-id'
import { BackupService } from './backups'
import { openDatabase } from './db'
import { ProjectsStore } from './projects-store'
import { ResourceService } from './resources'
import { TransactionService } from './transactions'

const FIXTURES = join(import.meta.dirname, '../../../tests/fixtures/discovery')

let service: ResourceService
let projectId: string
let serviceTmp: string

beforeEach(() => {
  serviceTmp = mkdtempSync(join(tmpdir(), 'agent-control-resources-'))
  const registry = new ProviderRegistry()
  registry.register(createCodexAdapter({ configRoot: join(FIXTURES, 'codex-user') }))
  registry.register(
    createClaudeAdapter({
      configRoot: join(FIXTURES, 'claude-user'),
      userMcpPath: join(FIXTURES, 'claude-user.json')
    })
  )
  const projects = new ProjectsStore(openDatabase(join(serviceTmp, 'test.db')))
  projectId = projects.add(join(FIXTURES, 'project')).id
  const backups = new BackupService(
    openDatabase(join(serviceTmp, 'backups.db')),
    join(serviceTmp, 'backups')
  )
  const transactions = new TransactionService(
    { roots: () => [serviceTmp], files: () => [] },
    backups
  )
  service = new ResourceService(registry, projects, transactions, backups)
})

afterEach(() => {
  rmSync(serviceTmp, { recursive: true, force: true })
})

describe('ResourceService.list', () => {
  it('lists every discovered resource with no query', async () => {
    expect(await service.list({})).toHaveLength(29)
  })

  it('filters by provider, kind, scope, and project', async () => {
    expect(await service.list({ providerId: 'codex' })).toHaveLength(10)
    expect(await service.list({ kind: 'agents' })).toHaveLength(9)
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

describe('ResourceService write path', () => {
  let tmp: string
  let agentPath: string
  let service: ResourceService
  let backups: BackupService

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agent-control-write-'))
    mkdirSync(join(tmp, 'claude', 'agents'), { recursive: true })
    agentPath = join(tmp, 'claude', 'agents', 'reviewer.md')
    writeFileSync(
      agentPath,
      '---\nname: reviewer\ndescription: Reviews PRs\n---\n\nBe thorough.\n'
    )
    const registry = new ProviderRegistry()
    registry.register(
      createClaudeAdapter({ configRoot: join(tmp, 'claude'), userMcpPath: join(tmp, 'claude.json') })
    )
    const projects = new ProjectsStore(openDatabase(join(tmp, 'projects.db')))
    backups = new BackupService(openDatabase(join(tmp, 'backups.db')), join(tmp, 'backups'))
    const transactions = new TransactionService({ roots: () => [tmp], files: () => [] }, backups)
    service = new ResourceService(registry, projects, transactions, backups)
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  async function readAgent() {
    const summaries = await service.list({ providerId: 'claude', kind: 'agents' })
    return service.read(summaries[0]!.id)
  }

  function formEdit(doc: ResourceDocument, description: string): ResourceMutation {
    return {
      action: 'edit',
      resourceId: doc.id,
      base: doc.fingerprints,
      edit: { mode: 'form', fields: { name: 'reviewer', description }, body: '\nBe thorough.\n' }
    }
  }

  it('read returns fingerprints for the source file', async () => {
    const doc = await readAgent()
    expect(doc.fingerprints).toHaveLength(1)
    expect(doc.fingerprints[0]?.path).toBe(agentPath)
    expect(doc.fingerprints[0]?.hash).toHaveLength(64)
  })

  it('previews a form edit with a unified diff and no conflicts', async () => {
    const doc = await readAgent()
    const preview = await service.preview(formEdit(doc, 'Reviews pull requests'))
    expect(preview.validation.ok).toBe(true)
    expect(preview.conflicts).toEqual([])
    expect(preview.operations).toHaveLength(1)
    expect(preview.diffs[0]?.unified).toContain('+description: Reviews pull requests')
    expect(preview.diffs[0]?.unified).toContain('-description: Reviews PRs')
  })

  it('applies a form edit, writes the file, and records a backup', async () => {
    const doc = await readAgent()
    const result = await service.apply(formEdit(doc, 'Reviews pull requests'))
    expect(result.document?.description).toBe('Reviews pull requests')
    expect(readFileSync(agentPath, 'utf8')).toContain('description: Reviews pull requests')
    expect(backups.list()).toHaveLength(1)
    expect(backups.list()[0]?.operation).toBe('update')
  })

  it('rejects a stale-base apply with a conflict', async () => {
    const doc = await readAgent()
    writeFileSync(agentPath, '---\nname: reviewer\ndescription: Changed outside\n---\nX\n')
    await expect(service.apply(formEdit(doc, 'Mine'))).rejects.toMatchObject({ code: 'conflict' })
  })

  it('surfaces stale fingerprints as preview conflicts', async () => {
    const doc = await readAgent()
    writeFileSync(agentPath, '---\nname: reviewer\ndescription: Changed outside\n---\nX\n')
    const preview = await service.preview(formEdit(doc, 'Mine'))
    expect(preview.conflicts).toEqual([agentPath])
  })

  it('blocks apply on validation errors and reports them via validate', async () => {
    const doc = await readAgent()
    const badSource: ResourceMutation = {
      action: 'edit',
      resourceId: doc.id,
      base: doc.fingerprints,
      edit: { mode: 'source', raw: '---\nname: [broken\n---\nX\n' }
    }
    const validation = await service.validate(badSource)
    expect(validation.ok).toBe(false)
    await expect(service.apply(badSource)).rejects.toMatchObject({ code: 'invalid-request' })
    expect(readFileSync(agentPath, 'utf8')).toContain('Reviews PRs') // untouched
  })

  it('restores a backup, snapshotting current state first', async () => {
    const original = readFileSync(agentPath, 'utf8')
    const doc = await readAgent()
    const applied = await service.apply(formEdit(doc, 'Reviews pull requests'))
    const restored = await service.restore(applied.backupId)
    expect(readFileSync(agentPath, 'utf8')).toBe(original)
    expect(restored.document?.description).toBe('Reviews PRs')
    expect(restored.backupId).not.toBe(applied.backupId)
    const entries = backups.list()
    expect(entries).toHaveLength(2)
    expect(entries[0]?.operation).toBe('restore')
  })

  it('turns planning failures into validation errors instead of throwing', async () => {
    const doc = await readAgent()
    const badFields: ResourceMutation = {
      action: 'edit',
      resourceId: doc.id,
      base: doc.fingerprints,
      edit: { mode: 'form', fields: { name: 42 } }
    }
    const validation = await service.validate(badFields)
    expect(validation.ok).toBe(false)
    expect(validation.diagnostics[0]?.message).toContain('name must be a string')
  })
})
