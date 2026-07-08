import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changedLineNumbers } from '../../../tests/helpers/diff'
import { TomlKeyNotFoundError, editTomlValue } from './toml-edit'

const fixture = readFileSync(
  join(import.meta.dirname, '../../../tests/fixtures/codex/config.toml'),
  'utf8'
)

describe('editTomlValue', () => {
  it('edits a top-level key changing only its line', () => {
    const result = editTomlValue(fixture, ['model'], '"o3"')
    expect(result).toContain('model = "o3" # primary model')
    expect(changedLineNumbers(fixture, result)).toEqual([4])
  })

  it('edits one MCP server entry without touching its siblings', () => {
    const result = editTomlValue(
      fixture,
      ['mcp_servers', 'filesystem', 'command'],
      '"new-cmd"'
    )
    expect(result).toContain('command = "new-cmd"')
    expect(result).toContain('command = "npx"')
    expect(changedLineNumbers(fixture, result)).toHaveLength(1)
  })

  it('is byte-identical outside the edited region', () => {
    const result = editTomlValue(fixture, ['approval_policy'], '"never"')
    const expected = fixture.replace(
      'approval_policy = "on-request"',
      'approval_policy = "never"'
    )
    expect(result).toBe(expected)
  })

  it('preserves comments and unknown sections verbatim', () => {
    const result = editTomlValue(fixture, ['model'], '"o3"')
    expect(result).toContain('# Hand-maintained ordering. Do not sort keys.')
    expect(result).toContain('undocumented_setting = "keep-me"')
    expect(result).toContain('# local files server')
  })

  it('throws TomlKeyNotFoundError for a missing key', () => {
    expect(() => editTomlValue(fixture, ['nonexistent'], '"x"')).toThrow(
      TomlKeyNotFoundError
    )
  })
})
