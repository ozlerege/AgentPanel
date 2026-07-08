import { basename } from 'node:path'
import type { NativeResource, ResourceDocument } from '../../../shared/resource'
import { buildDocument, missingFieldDiagnostics, stringField } from '../shared/document'
import type { ScopeTemplate } from '../shared/document'
import { parseFrontmatter } from '../shared/frontmatter'
import { listFiles, readTextFile } from '../shared/scan'

export function discoverClaudeAgents(
  agentsDir: string,
  template: ScopeTemplate
): NativeResource[] {
  return listFiles(agentsDir, '.md').map((path) => ({
    ...template,
    kind: 'agents',
    paths: [path]
  }))
}

export function parseClaudeAgent(native: NativeResource): ResourceDocument {
  const path = native.paths[0]
  const fallbackName = basename(path, '.md')
  const raw = readTextFile(path)
  if (raw === null) {
    return buildDocument(native, {
      name: fallbackName,
      fields: {},
      native: { format: 'markdown' },
      diagnostics: [{ severity: 'error', message: 'File could not be read', path }]
    })
  }
  const parsed = parseFrontmatter(raw)
  const diagnostics = parsed.diagnostics.map((diagnostic) => ({ ...diagnostic, path }))
  const parseFailed = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  return buildDocument(native, {
    name: stringField(parsed.fields, 'name') ?? fallbackName,
    description: stringField(parsed.fields, 'description'),
    fields: parsed.fields,
    native: { format: 'markdown', raw },
    diagnostics: parseFailed
      ? diagnostics
      : [
          ...diagnostics,
          ...missingFieldDiagnostics(parsed.fields, ['name', 'description'], path)
        ]
  })
}
