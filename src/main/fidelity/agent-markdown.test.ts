import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changedLineNumbers } from '../../../tests/helpers/diff'
import { applyFormModel, toFormModel } from './agent-markdown'

const fixture = readFileSync(
  join(import.meta.dirname, '../../../tests/fixtures/claude/agents/code-reviewer.md'),
  'utf8'
)

describe('agent markdown form round trip', () => {
  it('extracts known fields into the form model', () => {
    expect(toFormModel(fixture)).toEqual({
      name: 'code-reviewer',
      description: 'Reviews pull requests for style issues'
    })
  })

  it('returns the source byte-identical when nothing changed', () => {
    expect(applyFormModel(fixture, toFormModel(fixture))).toBe(fixture)
  })

  it('changes only the edited frontmatter line', () => {
    const result = applyFormModel(fixture, {
      name: 'code-reviewer',
      description: 'Reviews pull requests thoroughly'
    })
    expect(result).toContain('description: Reviews pull requests thoroughly')
    expect(changedLineNumbers(fixture, result)).toEqual([4])
  })

  it('preserves comments, unknown fields, and the body', () => {
    const result = applyFormModel(fixture, {
      name: 'code-reviewer',
      description: 'Reviews pull requests thoroughly'
    })
    expect(result).toContain('# Reviewer agent definition')
    expect(result).toContain('tools: Read, Grep, Glob # keep minimal')
    expect(result).toContain('custom_unknown_field:')
    expect(result).toContain('## Process')
  })
})
