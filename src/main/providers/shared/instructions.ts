import { basename } from 'node:path'
import type { NativeResource, ResourceDocument } from '../../../shared/resource'
import { buildDocument } from './document'
import type { ScopeTemplate } from './document'
import { fileExists, readTextFile } from './scan'

export function discoverInstructionsFile(
  path: string,
  template: ScopeTemplate
): NativeResource[] {
  return fileExists(path) ? [{ ...template, kind: 'instructions', paths: [path] }] : []
}

export function parseInstructions(native: NativeResource): ResourceDocument {
  const path = native.paths[0]
  const name = basename(path)
  const raw = readTextFile(path)
  if (raw === null) {
    return buildDocument(native, {
      name,
      fields: {},
      native: { format: 'markdown' },
      diagnostics: [{ severity: 'error', message: 'File could not be read', path }]
    })
  }
  return buildDocument(native, {
    name,
    fields: {},
    native: { format: 'markdown', raw },
    diagnostics: raw.trim() === '' ? [{ severity: 'info', message: 'File is empty', path }] : []
  })
}
