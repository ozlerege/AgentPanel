import { describe, expect, it } from 'vitest'
import type { NativeResource } from '../../../shared/resource'
import { buildDocument, missingFieldDiagnostics, stringField } from './document'
import { decodeResourceId } from './resource-id'

const native: NativeResource = {
  provider: 'claude',
  kind: 'agents',
  scope: 'user',
  paths: ['/tmp/does-not-exist.md']
}

describe('buildDocument', () => {
  it('fills the shared boilerplate and encodes a decodable id', () => {
    const doc = buildDocument(native, {
      name: 'x',
      fields: {},
      native: { format: 'markdown' },
      diagnostics: []
    })
    expect(doc.enabled).toBe(true)
    expect(doc.sourcePaths).toEqual(native.paths)
    expect(doc.provider).toBe('claude')
    expect(doc.kind).toBe('agents')
    expect(decodeResourceId(doc.id)).toMatchObject({
      provider: 'claude',
      kind: 'agents',
      scope: 'user',
      path: '/tmp/does-not-exist.md'
    })
    expect(doc.modifiedAt).toBe(new Date(0).toISOString())
  })

  it('carries entryKey into the id', () => {
    const doc = buildDocument(
      { ...native, kind: 'mcp-servers', entryKey: 'github' },
      {
        name: 'github',
        fields: {},
        native: { format: 'json' },
        diagnostics: []
      }
    )
    expect(decodeResourceId(doc.id).entryKey).toBe('github')
  })

  it('marks disabled file resources as disabled', () => {
    const doc = buildDocument(
      { ...native, disabled: true },
      {
        name: 'x',
        fields: {},
        native: { format: 'markdown' },
        diagnostics: []
      }
    )
    expect(doc.enabled).toBe(false)
  })

  it('fingerprints every source path, empty hash for missing files', () => {
    const doc = buildDocument(native, {
      name: 'x',
      fields: {},
      native: { format: 'markdown' },
      diagnostics: []
    })
    expect(doc.fingerprints).toEqual([{ path: '/tmp/does-not-exist.md', hash: '' }])
  })
})

describe('stringField', () => {
  it('returns non-empty strings and undefined otherwise', () => {
    expect(stringField({ a: 'x' }, 'a')).toBe('x')
    expect(stringField({ a: '  ' }, 'a')).toBeUndefined()
    expect(stringField({ a: 3 }, 'a')).toBeUndefined()
    expect(stringField({}, 'a')).toBeUndefined()
  })
})

describe('missingFieldDiagnostics', () => {
  it('warns per missing required field', () => {
    expect(
      missingFieldDiagnostics({ name: 'x' }, ['name', 'description'], '/f.md')
    ).toEqual([
      {
        severity: 'warning',
        message: 'Missing required field: description',
        path: '/f.md'
      }
    ])
  })
})
