import { basename, relative, sep } from 'node:path'
import type { NativeResource, ResourceDocument } from '../../../shared/resource'
import { buildDocument, stringField } from '../shared/document'
import type { ScopeTemplate } from '../shared/document'
import { parseFrontmatter } from '../shared/frontmatter'
import { listFilesRecursiveIncludingDisabled, readTextFile } from '../shared/scan'

export function discoverClaudeCommands(
  commandsDir: string,
  template: ScopeTemplate
): NativeResource[] {
  return listFilesRecursiveIncludingDisabled(commandsDir, '.md').map((path) => ({
    ...template,
    kind: 'commands',
    paths: [path],
    disabled: path.endsWith('.md.disabled'),
    entryKey: relative(commandsDir, path)
      .replace(/\.md(?:\.disabled)?$/, '')
      .split(sep)
      .join('/')
  }))
}

export function parseClaudeCommand(native: NativeResource): ResourceDocument {
  const path = native.paths[0]
  const name = native.entryKey ?? basename(path).replace(/\.md(?:\.disabled)?$/, '')
  const raw = readTextFile(path)
  if (raw === null) {
    return buildDocument(native, {
      name,
      fields: {},
      native: { format: 'markdown' },
      diagnostics: [{ severity: 'error', message: 'File could not be read', path }]
    })
  }
  const parsed = parseFrontmatter(raw)
  const diagnostics = parsed.diagnostics.map((diagnostic) => ({ ...diagnostic, path }))
  if (raw.trim() === '') {
    diagnostics.push({
      severity: 'warning',
      message: 'Command file is empty',
      path
    })
  }
  return buildDocument(native, {
    name,
    description: stringField(parsed.fields, 'description'),
    fields: parsed.fields,
    native: { format: 'markdown', raw },
    diagnostics
  })
}
