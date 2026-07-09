import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScopeTemplate } from '../shared/document'
import { discoverClaudeCommands, parseClaudeCommand } from './commands'

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/discovery')
const COMMANDS_DIR = join(FIXTURES, 'claude-user', 'commands')
const USER: ScopeTemplate = { provider: 'claude', scope: 'user' }

describe('discoverClaudeCommands', () => {
  it('finds commands recursively and names them by relative path', () => {
    const natives = discoverClaudeCommands(COMMANDS_DIR, USER)
    expect(natives.map((n) => n.entryKey)).toEqual([
      'deploy',
      'empty',
      'frontend/component',
      'off'
    ])
    expect(natives.find((n) => n.entryKey === 'off')?.disabled).toBe(true)
    expect(natives[0]).toMatchObject({
      provider: 'claude',
      kind: 'commands',
      scope: 'user'
    })
  })

  it('returns [] for a missing directory', () => {
    expect(discoverClaudeCommands(join(FIXTURES, 'nope'), USER)).toEqual([])
  })
})

describe('parseClaudeCommand', () => {
  const parse = (relative: string, entryKey: string) =>
    parseClaudeCommand({
      ...USER,
      kind: 'commands',
      paths: [join(COMMANDS_DIR, relative)],
      disabled: relative.endsWith('.disabled'),
      entryKey
    })

  it('parses a command with frontmatter description', () => {
    const doc = parse('deploy.md', 'deploy')
    expect(doc.name).toBe('deploy')
    expect(doc.description).toBe('Deploy the current branch')
    expect(doc.native.raw).toContain('$ARGUMENTS')
    expect(doc.diagnostics).toEqual([])
    expect(doc.enabled).toBe(true)
  })

  it('discovers disabled commands with clean names', () => {
    const doc = parse('off.md.disabled', 'off')
    expect(doc.name).toBe('off')
    expect(doc.enabled).toBe(false)
  })

  it('uses the namespaced entryKey as the name', () => {
    const doc = parse(join('frontend', 'component.md'), 'frontend/component')
    expect(doc.name).toBe('frontend/component')
    expect(doc.description).toBeUndefined()
    expect(doc.diagnostics).toEqual([])
  })

  it('warns for an empty command file', () => {
    const doc = parse('empty.md', 'empty')
    expect(doc.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Command file is empty',
        path: join(COMMANDS_DIR, 'empty.md')
      }
    ])
  })
})
