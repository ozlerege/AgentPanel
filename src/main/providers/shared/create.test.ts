import { describe, expect, it } from 'vitest'
import { AppOperationError } from '../../errors'
import {
  assertEntryKey,
  codexAgentTemplate,
  markdownTemplate,
  slugifyName
} from './create'

describe('create helpers', () => {
  it('slugifies display names for file paths', () => {
    expect(slugifyName('My Reviewer!', 'test')).toBe('my-reviewer')
    expect(slugifyName('  Many   Spaces  ', 'test')).toBe('many-spaces')
    expect(slugifyName('A_B.C', 'test')).toBe('a-b-c')
  })

  it('rejects names with no slug content', () => {
    expect(() => slugifyName('!!!', 'test')).toThrowError(
      expect.objectContaining({ code: 'invalid-request' }) as AppOperationError
    )
  })

  it('validates MCP entry keys', () => {
    expect(assertEntryKey('github_1-prod', 'test')).toBe('github_1-prod')
    expect(() => assertEntryKey('bad key', 'test')).toThrowError(
      expect.objectContaining({ code: 'invalid-request' }) as AppOperationError
    )
  })

  it('builds markdown templates byte-exactly', () => {
    expect(markdownTemplate('agents', 'Reviewer', 'Reviews PRs', 'Be careful.\n')).toBe(
      '---\nname: Reviewer\ndescription: Reviews PRs\n---\n\nBe careful.\n'
    )
    expect(markdownTemplate('commands', 'Deploy', 'Deploys', '')).toBe(
      '---\ndescription: Deploys\n---\n\nDescribe what this command does.\n'
    )
    expect(markdownTemplate('skills', 'Docs', '', '')).toBe(
      '---\nname: Docs\ndescription: \n---\n\nDescribe what this skill does.\n'
    )
  })

  it('builds codex agent templates with TOML escaping', () => {
    expect(codexAgentTemplate('Reviewer "A"', 'Line\nTwo', 'Use "care".')).toBe(
      'name = "Reviewer \\"A\\""\ndescription = "Line\\nTwo"\ndeveloper_instructions = "Use \\"care\\"."\n'
    )
  })
})
