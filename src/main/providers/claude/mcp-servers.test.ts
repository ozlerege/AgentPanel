import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverClaudeMcpServers, parseClaudeMcpServer } from './mcp-servers'

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/discovery')
const USER_MCP = join(FIXTURES, 'claude-user.json')
const BROKEN_MCP = join(FIXTURES, 'claude-user-broken.json')
const PROJECT = { id: 'project-1', path: join(FIXTURES, 'project') }

describe('discoverClaudeMcpServers', () => {
  it('emits one native per server entry across user and project scopes', () => {
    const natives = discoverClaudeMcpServers(USER_MCP, [PROJECT])
    expect(natives.map((n) => ({ scope: n.scope, entryKey: n.entryKey }))).toEqual([
      { scope: 'user', entryKey: 'github' },
      { scope: 'user', entryKey: 'incomplete' },
      { scope: 'project', entryKey: 'filesystem' }
    ])
    expect(natives[2]?.projectId).toBe('project-1')
    expect(natives[2]?.paths).toEqual([join(PROJECT.path, '.mcp.json')])
  })

  it('emits a single marker native (no entryKey) for a malformed file', () => {
    const natives = discoverClaudeMcpServers(BROKEN_MCP, [])
    expect(natives).toHaveLength(1)
    expect(natives[0]?.entryKey).toBeUndefined()
  })

  it('emits nothing when files are missing', () => {
    expect(
      discoverClaudeMcpServers(join(FIXTURES, 'nope.json'), [
        { id: 'p', path: join(FIXTURES, 'nope-project') }
      ])
    ).toEqual([])
  })
})

describe('parseClaudeMcpServer', () => {
  it('parses a healthy server entry', () => {
    const doc = parseClaudeMcpServer({
      provider: 'claude',
      kind: 'mcp-servers',
      scope: 'user',
      paths: [USER_MCP],
      entryKey: 'github'
    })
    expect(doc.name).toBe('github')
    expect(doc.fields['command']).toBe('npx')
    expect(doc.native.format).toBe('json')
    expect(doc.native.raw).toContain('mcpServers')
    expect(doc.diagnostics).toEqual([])
  })

  it('warns when command and url are both missing', () => {
    const doc = parseClaudeMcpServer({
      provider: 'claude',
      kind: 'mcp-servers',
      scope: 'user',
      paths: [USER_MCP],
      entryKey: 'incomplete'
    })
    expect(doc.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Missing required field: command (or url for remote servers)',
        path: USER_MCP
      }
    ])
  })

  it('parses the malformed-file marker into a synthetic error resource', () => {
    const doc = parseClaudeMcpServer({
      provider: 'claude',
      kind: 'mcp-servers',
      scope: 'user',
      paths: [BROKEN_MCP]
    })
    expect(doc.name).toBe('MCP configuration')
    expect(doc.diagnostics[0]?.severity).toBe('error')
    expect(doc.diagnostics[0]?.message).toContain('Invalid JSON')
    expect(doc.native.raw).toBeDefined()
  })

  it('reports an entry that vanished since discovery', () => {
    const doc = parseClaudeMcpServer({
      provider: 'claude',
      kind: 'mcp-servers',
      scope: 'user',
      paths: [USER_MCP],
      entryKey: 'gone'
    })
    expect(doc.diagnostics[0]?.severity).toBe('error')
    expect(doc.diagnostics[0]?.message).toContain('no longer present')
  })
})
