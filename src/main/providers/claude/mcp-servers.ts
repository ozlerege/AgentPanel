import { join } from 'node:path'
import { parse, printParseErrorCode } from 'jsonc-parser'
import type { ParseError } from 'jsonc-parser'
import type { NativeResource, ResourceDocument } from '../../../shared/resource'
import { buildDocument, stringField } from '../shared/document'
import type { ScopeTemplate } from '../shared/document'
import { readTextFile } from '../shared/scan'

interface McpFile {
  servers: Record<string, unknown> | null
  error: string | null
}

function readMcpFile(raw: string): McpFile {
  const errors: ParseError[] = []
  const value: unknown = parse(raw, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    const first = errors[0]
    return {
      servers: null,
      error: `${printParseErrorCode(first.error)} at offset ${first.offset}`
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { servers: null, error: 'top-level value is not an object' }
  }
  const servers = (value as Record<string, unknown>)['mcpServers']
  if (servers === undefined || servers === null) return { servers: {}, error: null }
  if (typeof servers !== 'object' || Array.isArray(servers)) {
    return { servers: null, error: 'mcpServers is not an object' }
  }
  return { servers: servers as Record<string, unknown>, error: null }
}

function discoverMcpJsonFile(path: string, template: ScopeTemplate): NativeResource[] {
  const raw = readTextFile(path)
  if (raw === null) return []
  const file = readMcpFile(raw)
  if (file.servers === null) {
    return [{ ...template, kind: 'mcp-servers', paths: [path] }]
  }
  return Object.keys(file.servers)
    .sort()
    .map((name) => ({
      ...template,
      kind: 'mcp-servers',
      paths: [path],
      entryKey: name
    }))
}

export function discoverClaudeMcpServers(
  userMcpPath: string,
  projects: Array<{ id: string; path: string }>
): NativeResource[] {
  return [
    ...discoverMcpJsonFile(userMcpPath, { provider: 'claude', scope: 'user' }),
    ...projects.flatMap((project) =>
      discoverMcpJsonFile(join(project.path, '.mcp.json'), {
        provider: 'claude',
        scope: 'project',
        projectId: project.id
      })
    )
  ]
}

export function parseClaudeMcpServer(native: NativeResource): ResourceDocument {
  const path = native.paths[0]
  const raw = readTextFile(path)
  if (raw === null) {
    return buildDocument(native, {
      name: native.entryKey ?? 'MCP configuration',
      fields: {},
      native: { format: 'json' },
      diagnostics: [{ severity: 'error', message: 'File could not be read', path }]
    })
  }
  const file = readMcpFile(raw)
  if (native.entryKey === undefined || file.servers === null) {
    return buildDocument(native, {
      name: 'MCP configuration',
      fields: {},
      native: { format: 'json', raw },
      diagnostics: [
        {
          severity: 'error',
          message: `Invalid JSON: ${file.error ?? 'unexpected content'}`,
          path
        }
      ]
    })
  }
  const entry = file.servers[native.entryKey]
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return buildDocument(native, {
      name: native.entryKey,
      fields: {},
      native: { format: 'json', raw },
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
    native: { format: 'json', raw },
    diagnostics
  })
}
