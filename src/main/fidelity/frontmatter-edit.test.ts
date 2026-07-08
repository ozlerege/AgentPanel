import { describe, expect, it } from 'vitest'
import { applyFrontmatterEdit } from './frontmatter-edit'

const AGENT = `---
# reviewer agent
name: code-reviewer
description: Reviews PRs
model: sonnet # keep me
---

You are a reviewer.
`

describe('applyFrontmatterEdit', () => {
  it('sets a single field, preserving comments and unknown fields byte-for-byte', () => {
    const result = applyFrontmatterEdit(AGENT, {
      fields: { description: 'Reviews pull requests' }
    })
    expect(result).toBe(AGENT.replace('description: Reviews PRs', 'description: Reviews pull requests'))
  })

  it('returns the source unchanged for a no-op edit', () => {
    expect(
      applyFrontmatterEdit(AGENT, {
        fields: { name: 'code-reviewer' },
        body: '\nYou are a reviewer.\n'
      })
    ).toBe(AGENT)
  })

  it('replaces the body without touching the frontmatter', () => {
    const result = applyFrontmatterEdit(AGENT, { body: '\nNew body.\n' })
    expect(result).toBe(AGENT.replace('\nYou are a reviewer.\n', '\nNew body.\n'))
    expect(result).toContain('# reviewer agent')
  })

  it('replaces the whole content for a body-only edit without frontmatter', () => {
    expect(applyFrontmatterEdit('Just text\n', { body: 'New\n' })).toBe('New\n')
  })

  it('creates a frontmatter block when fields are set on a plain document', () => {
    expect(applyFrontmatterEdit('Body\n', { fields: { description: 'X' } })).toBe(
      '---\ndescription: X\n---\nBody\n'
    )
  })

  it('handles frontmatter terminated at end-of-file', () => {
    expect(applyFrontmatterEdit('---\nname: a\n---', { fields: { name: 'b' } })).toBe(
      '---\nname: b\n---\n'
    )
  })

  it('throws for unterminated frontmatter', () => {
    expect(() => applyFrontmatterEdit('---\nname: a\n', { fields: { name: 'b' } })).toThrowError(
      'unterminated YAML frontmatter'
    )
  })
})
