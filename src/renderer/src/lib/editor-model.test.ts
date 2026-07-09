import { describe, expect, it } from 'vitest'
import type { ResourceDocument } from '@shared/resource'
import {
  buildResourceCreateDraft,
  formFieldSpecs,
  hasBodyEditor,
  initialArgs,
  initialEnv,
  initialFieldValues,
  splitBody,
  supportsSourceEdit
} from './editor-model'

function doc(overrides: Partial<ResourceDocument>): ResourceDocument {
  return {
    id: 'id',
    provider: 'claude',
    kind: 'agents',
    name: 'x',
    scope: 'user',
    enabled: 'unsupported',
    sourcePaths: ['/f.md'],
    fingerprints: [{ path: '/f.md', hash: 'h' }],
    fields: {},
    native: { format: 'markdown', raw: '' },
    diagnostics: [],
    modifiedAt: '2026-07-08T00:00:00.000Z',
    ...overrides
  }
}

describe('splitBody', () => {
  it('returns everything after the frontmatter block', () => {
    expect(splitBody('---\nname: a\n---\n\nBody\n')).toBe('\nBody\n')
    expect(splitBody('No frontmatter\n')).toBe('No frontmatter\n')
  })
})

describe('formFieldSpecs', () => {
  it('varies by provider and kind', () => {
    expect(formFieldSpecs(doc({})).map((spec) => spec.key)).toEqual(['name', 'description'])
    expect(
      formFieldSpecs(doc({ provider: 'codex', kind: 'agents' })).map((spec) => spec.key)
    ).toEqual(['name', 'description', 'developer_instructions'])
    expect(formFieldSpecs(doc({ kind: 'commands' })).map((spec) => spec.key)).toEqual([
      'description'
    ])
    expect(formFieldSpecs(doc({ kind: 'instructions' }))).toEqual([])
    expect(formFieldSpecs(doc({ kind: 'mcp-servers' }))).toEqual([])
  })
})

describe('capability flags', () => {
  it('mcp entries are form-only; codex agents have no body editor', () => {
    expect(supportsSourceEdit(doc({}))).toBe(true)
    expect(supportsSourceEdit(doc({ kind: 'mcp-servers' }))).toBe(false)
    expect(hasBodyEditor(doc({}))).toBe(true)
    expect(hasBodyEditor(doc({ provider: 'codex', kind: 'agents' }))).toBe(false)
    expect(hasBodyEditor(doc({ kind: 'mcp-servers' }))).toBe(false)
  })
})

describe('initial values', () => {
  it('extracts strings, args, and env rows defensively', () => {
    const mcp = doc({
      kind: 'mcp-servers',
      fields: { command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } }
    })
    expect(
      initialFieldValues(doc({ fields: { name: 'n', description: 3 } }), formFieldSpecs(doc({})))
    ).toEqual({
      name: 'n',
      description: ''
    })
    expect(initialArgs(mcp)).toBe('-y\npkg')
    expect(initialArgs(doc({ kind: 'mcp-servers' }))).toBe('')
    expect(initialEnv(mcp)).toEqual([{ key: 'A', value: '1' }])
    expect(initialEnv(doc({ kind: 'mcp-servers' }))).toEqual([])
  })
})

describe('buildResourceCreateDraft', () => {
  it('builds markdown resource drafts with provider-specific agent fields', () => {
    expect(
      buildResourceCreateDraft({
        provider: 'claude',
        kind: 'agents',
        scope: 'project',
        projectId: 'p1',
        name: 'Reviewer',
        description: 'Reviews PRs',
        body: 'Be thorough.'
      })
    ).toEqual({
      provider: 'claude',
      kind: 'agents',
      scope: 'project',
      projectId: 'p1',
      name: 'Reviewer',
      fields: { description: 'Reviews PRs' },
      body: 'Be thorough.'
    })

    expect(
      buildResourceCreateDraft({
        provider: 'codex',
        kind: 'agents',
        scope: 'user',
        name: 'Reviewer',
        description: 'Reviews PRs',
        developerInstructions: 'Use concise notes.'
      })
    ).toEqual({
      provider: 'codex',
      kind: 'agents',
      scope: 'user',
      name: 'Reviewer',
      fields: {
        description: 'Reviews PRs',
        developer_instructions: 'Use concise notes.'
      }
    })
  })

  it('builds MCP drafts by parsing args and environment rows', () => {
    expect(
      buildResourceCreateDraft({
        provider: 'claude',
        kind: 'mcp-servers',
        scope: 'user',
        name: 'github',
        command: 'npx',
        argsText: ' -y \nserver\n\n',
        envRows: [
          { key: 'TOKEN', value: 'secret' },
          { key: ' ', value: 'ignored' }
        ]
      })
    ).toEqual({
      provider: 'claude',
      kind: 'mcp-servers',
      scope: 'user',
      name: 'github',
      fields: {
        command: 'npx',
        args: ['-y', 'server'],
        env: { TOKEN: 'secret' }
      }
    })
  })

  it('includes imported raw content without adding a path', () => {
    expect(
      buildResourceCreateDraft({
        provider: 'claude',
        kind: 'commands',
        scope: 'user',
        name: 'deploy',
        description: 'Deploys',
        body: 'Run deploy.',
        raw: 'native content'
      })
    ).toEqual({
      provider: 'claude',
      kind: 'commands',
      scope: 'user',
      name: 'deploy',
      fields: { description: 'Deploys' },
      body: 'Run deploy.',
      raw: 'native content'
    })
  })
})
