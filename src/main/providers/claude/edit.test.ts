import { describe, expect, it } from 'vitest'
import { AppOperationError } from '../../errors'
import {
  applyClaudeMcpFormEdit,
  createClaudeMcpEntry,
  deleteClaudeMcpEntry,
  validateClaudeMcpContent
} from './edit'

const CONFIG = `{
  // user mcp config
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "abc" }
    },
    "plain": {
      "command": "bunx"
    }
  },
  "otherSetting": true
}
`

describe('applyClaudeMcpFormEdit', () => {
  it('changes command for one entry, preserving comments and other keys', () => {
    const result = applyClaudeMcpFormEdit(CONFIG, 'github', { command: 'bunx' }, 'op')
    expect(result).toContain('// user mcp config')
    expect(result).toContain('"otherSetting": true')
    expect(result).toContain('"command": "bunx"')
    expect(result).not.toContain('"command": "npx"')
  })

  it('replaces env and removes it when emptied', () => {
    const replaced = applyClaudeMcpFormEdit(CONFIG, 'github', { env: { A: '1' } }, 'op')
    expect(replaced).toContain('"A": "1"')
    expect(replaced).not.toContain('GITHUB_TOKEN')
    const removed = applyClaudeMcpFormEdit(CONFIG, 'github', { env: {} }, 'op')
    expect(removed).not.toContain('"env"')
    // emptying env on an entry that never had one is a no-op
    expect(applyClaudeMcpFormEdit(CONFIG, 'plain', { env: {} }, 'op')).toBe(CONFIG)
  })

  it('skips unchanged values entirely', () => {
    expect(
      applyClaudeMcpFormEdit(
        CONFIG,
        'github',
        {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'abc' }
        },
        'op'
      )
    ).toBe(CONFIG)
  })

  it('throws not-found for a missing entry and invalid-request for a malformed file', () => {
    try {
      applyClaudeMcpFormEdit(CONFIG, 'nope', { command: 'x' }, 'op')
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('not-found')
    }
    try {
      applyClaudeMcpFormEdit('{ "mcpServers": {', 'x', { command: 'c' }, 'op')
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('invalid-request')
    }
  })
})

describe('createClaudeMcpEntry / deleteClaudeMcpEntry', () => {
  it('creates an entry from absent or existing config content', () => {
    expect(createClaudeMcpEntry('{}', 'new', { command: 'bunx' }, 'op')).toBe(
      '{\n  "mcpServers": {\n    "new": {\n      "command": "bunx"\n    }\n  }\n}'
    )
    const existing = createClaudeMcpEntry(CONFIG, 'new', { command: 'bunx' }, 'op')
    expect(existing).toContain('"new": {')
    expect(existing).toContain('"command": "bunx"')
    expect(existing).toContain('"otherSetting": true')
  })

  it('rejects missing command and existing entries', () => {
    expect(() => createClaudeMcpEntry(CONFIG, 'new', {}, 'op')).toThrowError(
      expect.objectContaining({ code: 'invalid-request' })
    )
    expect(() => createClaudeMcpEntry(CONFIG, 'github', { command: 'x' }, 'op')).toThrowError(
      expect.objectContaining({ code: 'conflict' })
    )
  })

  it('deletes an entry', () => {
    const result = deleteClaudeMcpEntry(CONFIG, 'github', 'op')
    expect(result).not.toContain('"github"')
    expect(result).toContain('"plain"')
  })
})

describe('validateClaudeMcpContent', () => {
  it('accepts a healthy entry', () => {
    expect(validateClaudeMcpContent(CONFIG, 'github', '/c.json')).toEqual({
      ok: true,
      diagnostics: []
    })
  })

  it('errors on malformed JSON, missing entry, missing command/url, bad shapes', () => {
    expect(validateClaudeMcpContent('{ broken', 'x', '/c.json').ok).toBe(false)
    expect(validateClaudeMcpContent(CONFIG, 'nope', '/c.json').ok).toBe(false)
    expect(
      validateClaudeMcpContent('{ "mcpServers": { "x": { "args": [] } } }', 'x', '/c.json').ok
    ).toBe(false)
    expect(
      validateClaudeMcpContent('{ "mcpServers": { "x": { "command": "c", "args": "no" } } }', 'x', '/c.json').ok
    ).toBe(false)
    expect(
      validateClaudeMcpContent('{ "mcpServers": { "x": { "command": "c", "env": { "A": 1 } } } }', 'x', '/c.json').ok
    ).toBe(false)
  })

  it('accepts a url-only remote server', () => {
    expect(
      validateClaudeMcpContent('{ "mcpServers": { "x": { "url": "https://mcp.example" } } }', 'x', '/c.json').ok
    ).toBe(true)
  })
})
