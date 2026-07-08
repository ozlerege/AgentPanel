import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changedLineNumbers } from '../../../tests/helpers/diff'
import {
  deleteTomlKey,
  editTomlValue,
  hasTomlKeyValue,
  hasTomlTable,
  serializeTomlValue,
  setTomlValue,
  TomlKeyNotFoundError,
  TomlTableNotFoundError
} from './toml-edit'

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

const MCP = `# codex config
model = "gpt-5.5"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.github.env]
GITHUB_TOKEN = "abc" # keep

[other]
key = "value"
`

describe('serializeTomlValue', () => {
  it('serializes scalars, arrays, and inline tables with escaping', () => {
    expect(serializeTomlValue('plain')).toBe('"plain"')
    expect(serializeTomlValue('say "hi"\n')).toBe('"say \\"hi\\"\\n"')
    expect(serializeTomlValue(42)).toBe('42')
    expect(serializeTomlValue(true)).toBe('true')
    expect(serializeTomlValue(['a', 'b "c"'])).toBe('["a", "b \\"c\\""]')
    expect(serializeTomlValue({ A: '1', 'weird key': '2' })).toBe(
      '{ A = "1", "weird key" = "2" }'
    )
    expect(serializeTomlValue({})).toBe('{}')
  })
})

describe('setTomlValue', () => {
  it('replaces an existing value inside a table, byte-identical elsewhere', () => {
    expect(setTomlValue(MCP, ['mcp_servers', 'github'], 'command', 'bunx')).toBe(
      MCP.replace('command = "npx"', 'command = "bunx"')
    )
  })

  it('inserts a missing key after the last key-value of the table', () => {
    expect(
      setTomlValue(MCP, ['mcp_servers', 'github'], 'startup_timeout_sec', 30)
    ).toBe(
      MCP.replace(
        'args = ["-y", "@modelcontextprotocol/server-github"]\n',
        'args = ["-y", "@modelcontextprotocol/server-github"]\nstartup_timeout_sec = 30\n'
      )
    )
  })

  it('inserts a top-level key after the last top-level key-value', () => {
    expect(setTomlValue(MCP, [], 'approval_policy', 'never')).toBe(
      MCP.replace('model = "gpt-5.5"\n', 'model = "gpt-5.5"\napproval_policy = "never"\n')
    )
  })

  it('inserts into an empty table right after its header', () => {
    expect(setTomlValue('[empty]\n', ['empty'], 'key', 'v')).toBe('[empty]\nkey = "v"\n')
  })

  it('inserts at the start of a file with no top-level keys', () => {
    expect(setTomlValue('[t]\na = 1\n', [], 'x', 'v')).toBe('x = "v"\n[t]\na = 1\n')
  })

  it('throws TomlTableNotFoundError for a missing table', () => {
    expect(() => setTomlValue(MCP, ['nope'], 'k', 'v')).toThrowError(TomlTableNotFoundError)
  })
})

describe('deleteTomlKey', () => {
  it('removes the whole key line including its trailing comment', () => {
    expect(
      deleteTomlKey(MCP, ['mcp_servers', 'github', 'env'], 'GITHUB_TOKEN')
    ).toBe(MCP.replace('GITHUB_TOKEN = "abc" # keep\n', ''))
  })

  it('throws TomlKeyNotFoundError for a missing key', () => {
    expect(() => deleteTomlKey(MCP, ['mcp_servers', 'github'], 'nope')).toThrowError(
      TomlKeyNotFoundError
    )
  })
})

describe('hasTomlKeyValue / hasTomlTable', () => {
  it('distinguishes key-values from sub-tables', () => {
    expect(hasTomlKeyValue(MCP, ['mcp_servers', 'github', 'command'])).toBe(true)
    expect(hasTomlKeyValue(MCP, ['mcp_servers', 'github', 'env'])).toBe(false)
    expect(hasTomlTable(MCP, ['mcp_servers', 'github', 'env'])).toBe(true)
    expect(hasTomlTable(MCP, ['mcp_servers', 'nope'])).toBe(false)
  })

  it('treats an inline env table as a key-value', () => {
    const inline = '[mcp_servers.x]\nenv = { A = "1" }\n'
    expect(hasTomlKeyValue(inline, ['mcp_servers', 'x', 'env'])).toBe(true)
    expect(hasTomlTable(inline, ['mcp_servers', 'x', 'env'])).toBe(false)
  })
})
