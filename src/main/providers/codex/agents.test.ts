import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScopeTemplate } from '../shared/document'
import { discoverCodexAgents, parseCodexAgent } from './agents'

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/discovery')
const AGENTS_DIR = join(FIXTURES, 'codex-user', 'agents')
const USER: ScopeTemplate = { provider: 'codex', scope: 'user' }

describe('discoverCodexAgents', () => {
  it('finds every TOML agent, sorted', () => {
    const natives = discoverCodexAgents(AGENTS_DIR, USER)
    expect(natives.map((n) => n.paths[0])).toEqual([
      join(AGENTS_DIR, 'broken.toml'),
      join(AGENTS_DIR, 'no-description.toml'),
      join(AGENTS_DIR, 'off.toml.disabled'),
      join(AGENTS_DIR, 'reviewer.toml')
    ])
    expect(natives.find((n) => n.paths[0]?.endsWith('off.toml.disabled'))?.disabled).toBe(true)
    expect(natives[0]).toMatchObject({ provider: 'codex', kind: 'agents', scope: 'user' })
  })

  it('returns [] for a missing directory', () => {
    expect(discoverCodexAgents(join(FIXTURES, 'nope'), USER)).toEqual([])
  })
})

describe('parseCodexAgent', () => {
  const parse = (file: string) =>
    parseCodexAgent({
      ...USER,
      kind: 'agents',
      paths: [join(AGENTS_DIR, file)],
      disabled: file.endsWith('.disabled')
    })

  it('parses a healthy agent', () => {
    const doc = parse('reviewer.toml')
    expect(doc.name).toBe('reviewer')
    expect(doc.description).toBe('Reviews pull requests')
    expect(doc.fields['developer_instructions']).toBe('Be meticulous.')
    expect(doc.native.format).toBe('toml')
    expect(doc.native.raw).toContain('# Generated agent')
    expect(doc.diagnostics).toEqual([])
    expect(doc.enabled).toBe(true)
  })

  it('discovers disabled agents with clean names', () => {
    const doc = parse('off.toml.disabled')
    expect(doc.name).toBe('off')
    expect(doc.enabled).toBe(false)
  })

  it('warns when description is missing', () => {
    const doc = parse('no-description.toml')
    expect(doc.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Missing required field: description',
        path: join(AGENTS_DIR, 'no-description.toml')
      }
    ])
  })

  it('reports invalid TOML as an error and falls back to the filename', () => {
    const doc = parse('broken.toml')
    expect(doc.name).toBe('broken')
    expect(doc.diagnostics[0]?.severity).toBe('error')
    expect(doc.diagnostics[0]?.message).toContain('Invalid TOML')
    expect(doc.diagnostics).toHaveLength(1)
    expect(doc.native.raw).toBeDefined()
  })
})
