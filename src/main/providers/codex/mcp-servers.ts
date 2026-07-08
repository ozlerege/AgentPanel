import { join } from 'node:path'
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'
import type { NativeResource, ResourceDocument } from '../../../shared/resource'
import { buildDocument, stringField } from '../shared/document'
import { readTextFile } from '../shared/scan'

interface CodexConfig {
  servers: Record<string, unknown> | null
  error: string | null
}

function readCodexConfig(raw: string): CodexConfig {
  let value: unknown
  try {
    value = getStaticTOMLValue(parseTOML(raw))
  } catch (error) {
    return {
      servers: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { servers: null, error: 'top-level value is not a table' }
  }
  const servers = (value as Record<string, unknown>)['mcp_servers']
  if (servers === undefined || servers === null) return { servers: {}, error: null }
  if (typeof servers !== 'object' || Array.isArray(servers)) {
    return { servers: null, error: 'mcp_servers is not a table' }
  }
  return { servers: servers as Record<string, unknown>, error: null }
}

export function discoverCodexMcpServers(configRoot: string): NativeResource[] {
  const path = join(configRoot, 'config.toml')
  const raw = readTextFile(path)
  if (raw === null) return []
  const config = readCodexConfig(raw)
  const base: NativeResource = {
    provider: 'codex',
    kind: 'mcp-servers',
    scope: 'user',
    paths: [path]
  }
  if (config.servers === null) return [base]
  return Object.keys(config.servers)
    .sort()
    .map((name) => ({ ...base, entryKey: name }))
}

export function parseCodexMcpServer(native: NativeResource): ResourceDocument {
  const path = native.paths[0]
  const raw = readTextFile(path)
  if (raw === null) {
    return buildDocument(native, {
      name: native.entryKey ?? 'MCP configuration',
      fields: {},
      native: { format: 'toml' },
      diagnostics: [{ severity: 'error', message: 'File could not be read', path }]
    })
  }
  const config = readCodexConfig(raw)
  if (native.entryKey === undefined || config.servers === null) {
    return buildDocument(native, {
      name: 'MCP configuration',
      fields: {},
      native: { format: 'toml', raw },
      diagnostics: [
        {
          severity: 'error',
          message: `Invalid TOML: ${config.error ?? 'unexpected content'}`,
          path
        }
      ]
    })
  }
  const entry = config.servers[native.entryKey]
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return buildDocument(native, {
      name: native.entryKey,
      fields: {},
      native: { format: 'toml', raw },
      diagnostics: [
        {
          severity: 'error',
          message: `Server entry no longer present: ${native.entryKey}`,
          path
        }
      ]
    })
  }
  const fields = entry as Record<string, unknown>
  const diagnostics =
    stringField(fields, 'command') === undefined && stringField(fields, 'url') === undefined
      ? [
          {
            severity: 'warning' as const,
            message: 'Missing required field: command (or url for remote servers)',
            path
          }
        ]
      : []
  return buildDocument(native, {
    name: native.entryKey,
    fields,
    native: { format: 'toml', raw },
    diagnostics
  })
}
