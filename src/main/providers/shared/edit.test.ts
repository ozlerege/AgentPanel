import { describe, expect, it } from 'vitest'
import { AppOperationError } from '../../errors'
import {
  applyMarkdownFormEdit,
  mcpFormFields,
  sameStringRecord,
  stringFields,
  validateMarkdownContent
} from './edit'

const AGENT = `---
name: code-reviewer
description: Reviews PRs
model: sonnet
---

Body.
`

describe('stringFields', () => {
  it('picks only the requested string keys', () => {
    expect(stringFields({ a: 'x', b: 3, c: 'y' }, ['a', 'missing'], 'op')).toEqual({ a: 'x' })
  })

  it('throws invalid-request for a non-string requested key', () => {
    try {
      stringFields({ a: 3 }, ['a'], 'op')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AppOperationError)
      expect((error as AppOperationError).code).toBe('invalid-request')
    }
  })
})

describe('applyMarkdownFormEdit', () => {
  it('edits agent frontmatter and body', () => {
    const result = applyMarkdownFormEdit(
      AGENT,
      'agents',
      { name: 'code-reviewer', description: 'Reviews pull requests' },
      '\nNew body.\n',
      'op'
    )
    expect(result).toBe(
      AGENT.replace('description: Reviews PRs', 'description: Reviews pull requests').replace(
        '\nBody.\n',
        '\nNew body.\n'
      )
    )
  })

  it('only edits description for commands', () => {
    const result = applyMarkdownFormEdit(
      '---\ndescription: Old\n---\nRun it.\n',
      'commands',
      { description: 'New', name: 'ignored' },
      undefined,
      'op'
    )
    expect(result).toBe('---\ndescription: New\n---\nRun it.\n')
  })

  it('replaces the whole content for instructions', () => {
    expect(applyMarkdownFormEdit('Old\n', 'instructions', {}, 'New\n', 'op')).toBe('New\n')
    expect(applyMarkdownFormEdit('Old\n', 'instructions', {}, undefined, 'op')).toBe('Old\n')
  })
})

describe('validateMarkdownContent', () => {
  it('accepts a healthy agent', () => {
    expect(validateMarkdownContent('agents', AGENT, '/f.md')).toEqual({
      ok: true,
      diagnostics: []
    })
  })

  it('warns on missing description but stays ok', () => {
    const result = validateMarkdownContent('agents', '---\nname: a\n---\nB\n', '/f.md')
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([
      { severity: 'warning', message: 'Missing required field: description', path: '/f.md' }
    ])
  })

  it('rejects broken frontmatter', () => {
    const result = validateMarkdownContent('agents', '---\nname: [broken\n---\nB\n', '/f.md')
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.severity).toBe('error')
  })

  it('warns for an empty command, info for empty instructions', () => {
    const command = validateMarkdownContent('commands', '', '/c.md')
    expect(command.ok).toBe(true)
    expect(command.diagnostics).toEqual([
      { severity: 'warning', message: 'Command file is empty', path: '/c.md' }
    ])
    const instructions = validateMarkdownContent('instructions', '', '/i.md')
    expect(instructions.ok).toBe(true)
    expect(instructions.diagnostics).toEqual([
      { severity: 'info', message: 'File is empty', path: '/i.md' }
    ])
  })
})

describe('mcpFormFields', () => {
  it('narrows command, args, and env', () => {
    expect(
      mcpFormFields({ command: 'npx', args: ['-y'], env: { A: '1' }, extra: 5 }, 'op')
    ).toEqual({ command: 'npx', args: ['-y'], env: { A: '1' } })
    expect(mcpFormFields({}, 'op')).toEqual({})
  })

  it('throws invalid-request on bad shapes', () => {
    expect(() => mcpFormFields({ command: 3 }, 'op')).toThrowError(AppOperationError)
    expect(() => mcpFormFields({ args: ['a', 1] }, 'op')).toThrowError(AppOperationError)
    expect(() => mcpFormFields({ env: { A: 1 } }, 'op')).toThrowError(AppOperationError)
    expect(() => mcpFormFields({ env: ['x'] }, 'op')).toThrowError(AppOperationError)
  })
})

describe('sameStringRecord', () => {
  it('compares records ignoring key order', () => {
    expect(sameStringRecord({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true)
    expect(sameStringRecord({ a: '1' }, { a: '2' })).toBe(false)
    expect(sameStringRecord({ a: '1' }, {})).toBe(false)
  })
})
