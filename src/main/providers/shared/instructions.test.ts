import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScopeTemplate } from './document'
import { discoverInstructionsFile, parseInstructions } from './instructions'

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/discovery')
const CLAUDE_MD = join(FIXTURES, 'claude-user', 'CLAUDE.md')
const EMPTY_AGENTS_MD = join(FIXTURES, 'codex-user', 'AGENTS.md')
const CLAUDE_USER: ScopeTemplate = { provider: 'claude', scope: 'user' }
const CODEX_USER: ScopeTemplate = { provider: 'codex', scope: 'user' }

describe('discoverInstructionsFile', () => {
  it('emits one native when the file exists', () => {
    expect(discoverInstructionsFile(CLAUDE_MD, CLAUDE_USER)).toEqual([
      {
        provider: 'claude',
        scope: 'user',
        kind: 'instructions',
        paths: [CLAUDE_MD]
      }
    ])
  })

  it('emits nothing when the file is missing', () => {
    expect(discoverInstructionsFile(join(FIXTURES, 'nope.md'), CLAUDE_USER)).toEqual([])
  })
})

describe('parseInstructions', () => {
  it('parses an instructions file, named after the file', () => {
    const doc = parseInstructions({
      ...CLAUDE_USER,
      kind: 'instructions',
      paths: [CLAUDE_MD]
    })
    expect(doc.name).toBe('CLAUDE.md')
    expect(doc.native.raw).toContain('Prefer TypeScript')
    expect(doc.diagnostics).toEqual([])
  })

  it('flags an empty file with an info diagnostic', () => {
    const doc = parseInstructions({
      ...CODEX_USER,
      kind: 'instructions',
      paths: [EMPTY_AGENTS_MD]
    })
    expect(doc.name).toBe('AGENTS.md')
    expect(doc.diagnostics).toEqual([
      { severity: 'info', message: 'File is empty', path: EMPTY_AGENTS_MD }
    ])
  })
})
