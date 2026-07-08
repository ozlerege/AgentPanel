import { describe, expect, it } from 'vitest'
import {
  appErrorSchema,
  backupEntrySchema,
  changePreviewSchema,
  ipcContract,
  projectSchema,
  resourceDocumentSchema,
  resourceSummarySchema
} from './ipc'

describe('ipc contract schemas', () => {
  it('accepts a valid project', () => {
    const project = {
      id: 'b3e1c9a2-0000-4000-8000-000000000000',
      name: 'my-app',
      path: '/Users/example/my-app',
      addedAt: '2026-07-08T12:00:00.000Z'
    }
    expect(projectSchema.parse(project)).toEqual(project)
  })

  it('rejects a projects:remove request without an id', () => {
    const result = ipcContract['projects:remove'].request.safeParse({})
    expect(result.success).toBe(false)
  })

  it('accepts undefined payload for parameterless channels', () => {
    expect(ipcContract['providers:detect'].request.safeParse(undefined).success).toBe(true)
    expect(ipcContract['projects:list'].request.safeParse(undefined).success).toBe(true)
  })

  it('requires the actionable-error fields from spec section 16', () => {
    const error = {
      code: 'conflict',
      operation: 'projects:add',
      message: 'Project already registered',
      changed: false
    }
    expect(appErrorSchema.parse(error)).toEqual(error)
    expect(appErrorSchema.safeParse({ message: 'x' }).success).toBe(false)
  })

  it('accepts an empty resources:list query and rejects an unsupported scope', () => {
    expect(ipcContract['resources:list'].request.safeParse({}).success).toBe(true)
    expect(
      ipcContract['resources:list'].request.safeParse({
        providerId: 'codex',
        kind: 'agents',
        scope: 'user'
      }).success
    ).toBe(true)
    expect(
      ipcContract['resources:list'].request.safeParse({ scope: 'directory' }).success
    ).toBe(false)
  })

  it('requires an id for resources:read', () => {
    expect(ipcContract['resources:read'].request.safeParse({}).success).toBe(false)
    expect(ipcContract['resources:read'].request.safeParse({ id: 'abc' }).success).toBe(true)
  })

  it('accepts resource summary and document shapes', () => {
    const summary = {
      id: 'abc',
      provider: 'claude',
      kind: 'agents',
      name: 'code-reviewer',
      scope: 'user',
      enabled: 'unsupported',
      sourcePaths: ['/tmp/a.md'],
      diagnostics: [
        { severity: 'warning', message: 'Missing required field: description' }
      ],
      modifiedAt: '2026-07-08T12:00:00.000Z'
    }
    expect(resourceSummarySchema.safeParse(summary).success).toBe(true)
    const document = {
      ...summary,
      fingerprints: [{ path: '/tmp/a.md', hash: 'aa' }],
      fields: { model: 'sonnet' },
      native: { format: 'markdown', raw: '---\n' }
    }
    expect(resourceDocumentSchema.safeParse(document).success).toBe(true)
    expect(resourceDocumentSchema.safeParse(summary).success).toBe(false)
  })
})

describe('resource edit channels', () => {
  const formEdit = {
    resourceId: 'abc',
    base: [{ path: '/f.md', hash: 'aa' }],
    edit: { mode: 'form', fields: { name: 'x' }, body: 'B' }
  }
  const sourceEdit = {
    resourceId: 'abc',
    base: [],
    edit: { mode: 'source', raw: '---\nname: x\n---\n' }
  }

  it('accepts form and source edits on validate/preview/apply', () => {
    for (const channel of ['resources:validate', 'resources:preview', 'resources:apply'] as const) {
      expect(ipcContract[channel].request.parse(formEdit)).toEqual(formEdit)
      expect(ipcContract[channel].request.parse(sourceEdit)).toEqual(sourceEdit)
    }
  })

  it('rejects unknown edit modes and missing fields', () => {
    const bad = { resourceId: 'abc', base: [], edit: { mode: 'patch', raw: 'x' } }
    expect(ipcContract['resources:apply'].request.safeParse(bad).success).toBe(false)
    expect(ipcContract['resources:apply'].request.safeParse({}).success).toBe(false)
  })

  it('validates restore and backups:list requests', () => {
    expect(ipcContract['resources:restore'].request.parse({ backupId: 'b1' })).toEqual({
      backupId: 'b1'
    })
    expect(ipcContract['backups:list'].request.parse({})).toEqual({})
    expect(ipcContract['backups:list'].request.parse({ resourceId: 'r' })).toEqual({
      resourceId: 'r'
    })
  })

  it('parses a change preview and a backup entry', () => {
    const preview = {
      operations: [{ kind: 'write', path: '/f.md', content: 'new' }],
      diffs: [{ path: '/f.md', unified: '@@ -1 +1 @@' }],
      validation: { ok: true, diagnostics: [] },
      conflicts: []
    }
    expect(changePreviewSchema.parse(preview)).toEqual(preview)
    const entry = {
      id: 'b1',
      resourceId: 'r1',
      resourceName: 'code-reviewer',
      provider: 'claude',
      kind: 'agents',
      operation: 'update',
      paths: ['/f.md'],
      createdAt: '2026-07-08T00:00:00.000Z'
    }
    expect(backupEntrySchema.parse(entry)).toEqual(entry)
  })
})
