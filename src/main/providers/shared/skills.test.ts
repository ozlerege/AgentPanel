import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScopeTemplate } from './document'
import { discoverSkills, parseSkill } from './skills'

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/discovery')
const CLAUDE_SKILLS = join(FIXTURES, 'claude-user', 'skills')
const CODEX_SKILLS = join(FIXTURES, 'codex-user', 'skills')
const CLAUDE_USER: ScopeTemplate = { provider: 'claude', scope: 'user' }
const CODEX_USER: ScopeTemplate = { provider: 'codex', scope: 'user' }

describe('discoverSkills', () => {
  it('emits one native per skill directory, pointing at SKILL.md', () => {
    const natives = discoverSkills(CLAUDE_SKILLS, CLAUDE_USER)
    expect(natives.map((n) => n.paths[0])).toEqual([
      join(CLAUDE_SKILLS, 'no-desc', 'SKILL.md'),
      join(CLAUDE_SKILLS, 'off-skill', 'SKILL.md.disabled'),
      join(CLAUDE_SKILLS, 'writing-docs', 'SKILL.md')
    ])
    expect(natives.find((n) => n.paths[0]?.endsWith('SKILL.md.disabled'))?.disabled).toBe(true)
    expect(natives[0]).toMatchObject({ provider: 'claude', kind: 'skills', scope: 'user' })
  })

  it('returns [] for a missing directory', () => {
    expect(discoverSkills(join(FIXTURES, 'nope'), CLAUDE_USER)).toEqual([])
  })
})

describe('parseSkill', () => {
  it('parses a healthy skill', () => {
    const doc = parseSkill({
      ...CLAUDE_USER,
      kind: 'skills',
      paths: [join(CLAUDE_SKILLS, 'writing-docs', 'SKILL.md')]
    })
    expect(doc.name).toBe('writing-docs')
    expect(doc.description).toBe('Structure and edit technical documentation')
    expect(doc.native.format).toBe('markdown')
    expect(doc.diagnostics).toEqual([])
    expect(doc.enabled).toBe(true)
  })

  it('discovers disabled skills with clean names', () => {
    const doc = parseSkill({
      ...CLAUDE_USER,
      kind: 'skills',
      paths: [join(CLAUDE_SKILLS, 'off-skill', 'SKILL.md.disabled')],
      disabled: true
    })
    expect(doc.name).toBe('off-skill')
    expect(doc.enabled).toBe(false)
  })

  it('warns when description is missing', () => {
    const path = join(CLAUDE_SKILLS, 'no-desc', 'SKILL.md')
    const doc = parseSkill({ ...CLAUDE_USER, kind: 'skills', paths: [path] })
    expect(doc.diagnostics).toEqual([
      { severity: 'warning', message: 'Missing required field: description', path }
    ])
  })

  it('reports a skill directory without SKILL.md as an error', () => {
    const doc = parseSkill({
      ...CODEX_USER,
      kind: 'skills',
      paths: [join(CODEX_SKILLS, 'no-manifest', 'SKILL.md')]
    })
    expect(doc.name).toBe('no-manifest')
    expect(doc.native.format).toBe('directory')
    expect(doc.diagnostics).toEqual([
      {
        severity: 'error',
        message: 'Skill directory has no SKILL.md',
        path: join(CODEX_SKILLS, 'no-manifest')
      }
    ])
  })

  it('lists supporting files without parsing them', () => {
    const doc = parseSkill({
      ...CODEX_USER,
      kind: 'skills',
      paths: [join(CODEX_SKILLS, 'deploy-helper', 'SKILL.md')]
    })
    expect(doc.fields['supportingFiles']).toBeUndefined()
    const withExtras = parseSkill({
      ...CODEX_USER,
      kind: 'skills',
      paths: [join(CODEX_SKILLS, 'no-manifest', 'SKILL.md')]
    })
    expect(withExtras.fields['supportingFiles']).toEqual(['README.md'])
  })
})
