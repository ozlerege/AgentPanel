import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScopeTemplate } from '../shared/document'
import { discoverClaudeAgents, parseClaudeAgent } from './agents'

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/discovery')
const AGENTS_DIR = join(FIXTURES, 'claude-user', 'agents')
const USER: ScopeTemplate = { provider: 'claude', scope: 'user' }

describe('discoverClaudeAgents', () => {
  it('finds every markdown agent, sorted', () => {
    const natives = discoverClaudeAgents(AGENTS_DIR, USER)
    expect(natives.map((n) => n.paths[0])).toEqual([
      join(AGENTS_DIR, 'broken.md'),
      join(AGENTS_DIR, 'code-reviewer.md'),
      join(AGENTS_DIR, 'no-description.md')
    ])
    expect(natives[0]).toMatchObject({
      provider: 'claude',
      kind: 'agents',
      scope: 'user'
    })
  })

  it('returns [] for a missing directory', () => {
    expect(discoverClaudeAgents(join(FIXTURES, 'nope'), USER)).toEqual([])
  })
})

describe('parseClaudeAgent', () => {
  const parse = (file: string) =>
    parseClaudeAgent({
      ...USER,
      kind: 'agents',
      paths: [join(AGENTS_DIR, file)]
    })

  it('parses a healthy agent', () => {
    const doc = parse('code-reviewer.md')
    expect(doc.name).toBe('code-reviewer')
    expect(doc.description).toBe('Reviews pull requests for style issues')
    expect(doc.fields['model']).toBe('sonnet')
    expect(doc.native.format).toBe('markdown')
    expect(doc.native.raw).toContain('meticulous')
    expect(doc.diagnostics).toEqual([])
    expect(doc.enabled).toBe('unsupported')
  })

  it('warns when description is missing', () => {
    const doc = parse('no-description.md')
    expect(doc.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Missing required field: description',
        path: join(AGENTS_DIR, 'no-description.md')
      }
    ])
  })

  it('reports malformed frontmatter as an error and falls back to the filename', () => {
    const doc = parse('broken.md')
    expect(doc.name).toBe('broken')
    expect(doc.diagnostics.some((d) => d.severity === 'error')).toBe(true)
    expect(doc.diagnostics.some((d) => d.severity === 'warning')).toBe(false)
    expect(doc.native.raw).toBeDefined()
  })

  it('contains an unreadable file as an error diagnostic', () => {
    const doc = parse('missing.md')
    expect(doc.name).toBe('missing')
    expect(doc.diagnostics).toEqual([
      {
        severity: 'error',
        message: 'File could not be read',
        path: join(AGENTS_DIR, 'missing.md')
      }
    ])
  })
})
