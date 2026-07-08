import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverCodexMcpServers, parseCodexMcpServer } from './mcp-servers'

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/discovery')
const CODEX_ROOT = join(FIXTURES, 'codex-user')
const BROKEN_ROOT = join(FIXTURES, 'codex-user-broken')
const CONFIG = join(CODEX_ROOT, 'config.toml')

describe('discoverCodexMcpServers', () => {
  it('emits one native per mcp_servers entry, sorted', () => {
    const natives = discoverCodexMcpServers(CODEX_ROOT)
    expect(natives.map((n) => n.entryKey)).toEqual(['github', 'incomplete'])
    expect(natives[0]).toMatchObject({
      provider: 'codex',
      kind: 'mcp-servers',
      scope: 'user',
      paths: [CONFIG]
    })
  })

  it('emits a single marker native for a malformed config.toml', () => {
    const natives = discoverCodexMcpServers(BROKEN_ROOT)
    expect(natives).toHaveLength(1)
    expect(natives[0]?.entryKey).toBeUndefined()
  })

  it('emits nothing when config.toml is missing', () => {
    expect(discoverCodexMcpServers(join(FIXTURES, 'nope'))).toEqual([])
  })
})

describe('parseCodexMcpServer', () => {
  it('parses a healthy server entry', () => {
    const doc = parseCodexMcpServer({
      provider: 'codex',
      kind: 'mcp-servers',
      scope: 'user',
      paths: [CONFIG],
      entryKey: 'github'
    })
    expect(doc.name).toBe('github')
    expect(doc.fields['command']).toBe('npx')
    expect(doc.native.format).toBe('toml')
    expect(doc.diagnostics).toEqual([])
  })

  it('warns when command and url are both missing', () => {
    const doc = parseCodexMcpServer({
      provider: 'codex',
      kind: 'mcp-servers',
      scope: 'user',
      paths: [CONFIG],
      entryKey: 'incomplete'
    })
    expect(doc.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Missing required field: command (or url for remote servers)',
        path: CONFIG
      }
    ])
  })

  it('parses the malformed-file marker into a synthetic error resource', () => {
    const doc = parseCodexMcpServer({
      provider: 'codex',
      kind: 'mcp-servers',
      scope: 'user',
      paths: [join(BROKEN_ROOT, 'config.toml')]
    })
    expect(doc.name).toBe('MCP configuration')
    expect(doc.diagnostics[0]?.severity).toBe('error')
    expect(doc.diagnostics[0]?.message).toContain('Invalid TOML')
  })
})
