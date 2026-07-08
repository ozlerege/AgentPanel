import { basename } from 'node:path'
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'
import type { Diagnostic, NativeResource, ResourceDocument } from '../../../shared/resource'
import { buildDocument, missingFieldDiagnostics, stringField } from '../shared/document'
import type { ScopeTemplate } from '../shared/document'
import { listFiles, readTextFile } from '../shared/scan'

export function discoverCodexAgents(
  agentsDir: string,
  template: ScopeTemplate
): NativeResource[] {
  return listFiles(agentsDir, '.toml').map((path) => ({
    ...template,
    kind: 'agents',
    paths: [path]
  }))
}

export function parseCodexAgent(native: NativeResource): ResourceDocument {
  const path = native.paths[0]
  const fallbackName = basename(path, '.toml')
  const raw = readTextFile(path)
  if (raw === null) {
    return buildDocument(native, {
      name: fallbackName,
      fields: {},
      native: { format: 'toml' },
      diagnostics: [{ severity: 'error', message: 'File could not be read', path }]
    })
  }
  let fields: Record<string, unknown> = {}
  const diagnostics: Diagnostic[] = []
  try {
    const value: unknown = getStaticTOMLValue(parseTOML(raw))
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      fields = value as Record<string, unknown>
    }
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      message: `Invalid TOML: ${error instanceof Error ? error.message : String(error)}`,
      path
    })
  }
  if (diagnostics.length === 0) {
    diagnostics.push(...missingFieldDiagnostics(fields, ['name', 'description'], path))
  }
  return buildDocument(native, {
    name: stringField(fields, 'name') ?? fallbackName,
    description: stringField(fields, 'description'),
    fields,
    native: { format: 'toml', raw },
    diagnostics
  })
}
