import { describe, expect, it } from 'vitest'
import { AppOperationError } from '../../errors'
import {
  applyCodexAgentFormEdit,
  applyCodexMcpFormEdit,
  createCodexMcpEntry,
  deleteCodexMcpEntry,
  validateCodexAgentContent,
  validateCodexMcpContent
} from './edit'

const AGENT = `# codex agent
name = "helper"
description = "Helps" # keep
developer_instructions = "Be nice"
`

const CONFIG = `model = "gpt-5.5"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.github.env]
GITHUB_TOKEN = "abc"

[mcp_servers.inline]
command = "bunx"
env = { A = "1" }
`

describe('applyCodexAgentFormEdit', () => {
  it('replaces only changed fields, preserving comments', () => {
    const result = applyCodexAgentFormEdit(
      AGENT,
      { name: 'helper', description: 'Helps a lot' },
      'op'
    )
    expect(result).toBe(AGENT.replace('"Helps"', '"Helps a lot"'))
  })

  it('inserts a field that does not exist yet', () => {
    const result = applyCodexAgentFormEdit('name = "x"\n', { description: 'D' }, 'op')
    expect(result).toBe('name = "x"\ndescription = "D"\n')
  })

  it('rejects editing an unparseable file', () => {
    expect(() => applyCodexAgentFormEdit('name = [broken', { name: 'x' }, 'op')).toThrowError(
      AppOperationError
    )
  })
})

describe('applyCodexMcpFormEdit', () => {
  it('changes command inside one entry only', () => {
    const result = applyCodexMcpFormEdit(CONFIG, 'github', { command: 'bunx' }, 'op')
    expect(result).toBe(CONFIG.replace('command = "npx"', 'command = "bunx"'))
  })

  it('edits env keys in a sub-table: set, add, delete', () => {
    const result = applyCodexMcpFormEdit(
      CONFIG,
      'github',
      { env: { GITHUB_TOKEN: 'xyz', NEW_VAR: '1' } },
      'op'
    )
    expect(result).toContain('GITHUB_TOKEN = "xyz"')
    expect(result).toContain('NEW_VAR = "1"')
    const removed = applyCodexMcpFormEdit(CONFIG, 'github', { env: {} }, 'op')
    expect(removed).not.toContain('GITHUB_TOKEN')
    expect(removed).toContain('[mcp_servers.github.env]')
  })

  it('replaces an inline env wholesale', () => {
    const result = applyCodexMcpFormEdit(CONFIG, 'inline', { env: { A: '2', B: '3' } }, 'op')
    expect(result).toBe(CONFIG.replace('env = { A = "1" }', 'env = { A = "2", B = "3" }'))
  })

  it('inserts an inline env when none exists', () => {
    const result = applyCodexMcpFormEdit(CONFIG, 'github', { env: undefined }, 'op')
    expect(result).toBe(CONFIG) // no env in the form -> untouched
    const withEnv = `[mcp_servers.solo]\ncommand = "x"\n`
    expect(applyCodexMcpFormEdit(withEnv, 'solo', { env: { K: 'v' } }, 'op')).toBe(
      `[mcp_servers.solo]\ncommand = "x"\nenv = { K = "v" }\n`
    )
  })

  it('replaces args as a whole array and skips unchanged args', () => {
    const result = applyCodexMcpFormEdit(CONFIG, 'github', { args: ['-y', 'other'] }, 'op')
    expect(result).toBe(
      CONFIG.replace(
        'args = ["-y", "@modelcontextprotocol/server-github"]',
        'args = ["-y", "other"]'
      )
    )
    expect(
      applyCodexMcpFormEdit(
        CONFIG,
        'github',
        { args: ['-y', '@modelcontextprotocol/server-github'] },
        'op'
      )
    ).toBe(CONFIG)
  })

  it('throws not-found for a missing entry', () => {
    try {
      applyCodexMcpFormEdit(CONFIG, 'nope', { command: 'x' }, 'op')
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('not-found')
    }
  })
})

describe('createCodexMcpEntry / deleteCodexMcpEntry', () => {
  it('creates a new MCP entry from form fields', () => {
    const result = createCodexMcpEntry(CONFIG, 'new-server', {
      command: 'bunx',
      args: ['-y', 'server'],
      env: { TOKEN: 'abc' }
    }, 'op')
    expect(result).toContain('[mcp_servers.new-server]\n')
    expect(result).toContain('command = "bunx"\n')
    expect(result).toContain('args = ["-y", "server"]\n')
    expect(result).toContain('env = { TOKEN = "abc" }\n')
  })

  it('rejects missing command and existing entries', () => {
    expect(() => createCodexMcpEntry(CONFIG, 'new-server', {}, 'op')).toThrowError(
      expect.objectContaining({ code: 'invalid-request' })
    )
    expect(() => createCodexMcpEntry(CONFIG, 'github', { command: 'x' }, 'op')).toThrowError(
      expect.objectContaining({ code: 'conflict' })
    )
  })

  it('deletes an MCP entry and its env table', () => {
    const result = deleteCodexMcpEntry(CONFIG, 'github', 'op')
    expect(result).not.toContain('[mcp_servers.github]')
    expect(result).not.toContain('[mcp_servers.github.env]')
    expect(result).toContain('[mcp_servers.inline]')
  })
})

describe('validateCodexAgentContent', () => {
  it('accepts a healthy agent and flags missing description', () => {
    expect(validateCodexAgentContent(AGENT, '/a.toml').ok).toBe(true)
    const missing = validateCodexAgentContent('name = "x"\n', '/a.toml')
    expect(missing.ok).toBe(true)
    expect(missing.diagnostics).toEqual([
      { severity: 'warning', message: 'Missing required field: description', path: '/a.toml' }
    ])
  })

  it('rejects invalid TOML', () => {
    const result = validateCodexAgentContent('name = [broken', '/a.toml')
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.message).toContain('Invalid TOML')
  })
})

describe('validateCodexMcpContent', () => {
  it('accepts a healthy entry', () => {
    expect(validateCodexMcpContent(CONFIG, 'github', '/c.toml')).toEqual({
      ok: true,
      diagnostics: []
    })
  })

  it('errors when command and url are both missing', () => {
    const noCommand = `[mcp_servers.x]\nargs = ["a"]\n`
    const result = validateCodexMcpContent(noCommand, 'x', '/c.toml')
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.message).toContain('command')
  })

  it('errors on bad args or env shapes and missing entries', () => {
    expect(validateCodexMcpContent(`[mcp_servers.x]\ncommand = "c"\nargs = "no"\n`, 'x', '/c.toml').ok).toBe(false)
    expect(validateCodexMcpContent(`[mcp_servers.x]\ncommand = "c"\nenv = 3\n`, 'x', '/c.toml').ok).toBe(false)
    expect(validateCodexMcpContent(CONFIG, 'nope', '/c.toml').ok).toBe(false)
    expect(validateCodexMcpContent('broken = [', 'x', '/c.toml').ok).toBe(false)
  })
})
