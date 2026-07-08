import type { Diagnostic, ValidationResult } from '../../../shared/resource'
import { AppOperationError } from '../../errors'
import { applyFrontmatterEdit } from '../../fidelity/frontmatter-edit'
import { missingFieldDiagnostics } from './document'
import { parseFrontmatter } from './frontmatter'

export type MarkdownKind = 'agents' | 'skills' | 'commands' | 'instructions'

/** Narrow the requested keys to string values; reject non-strings. */
export function stringFields(
  fields: Record<string, unknown>,
  keys: string[],
  operation: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) {
    const value = fields[key]
    if (value === undefined) continue
    if (typeof value !== 'string') {
      throw new AppOperationError('invalid-request', operation, `Field ${key} must be a string`)
    }
    out[key] = value
  }
  return out
}

/** New file content for a form edit of a markdown-based resource. */
export function applyMarkdownFormEdit(
  raw: string,
  kind: MarkdownKind,
  fields: Record<string, unknown>,
  body: string | undefined,
  operation: string
): string {
  if (kind === 'instructions') return body ?? raw
  const editable = kind === 'commands' ? ['description'] : ['name', 'description']
  return applyFrontmatterEdit(raw, { fields: stringFields(fields, editable, operation), body })
}

/** Validate proposed markdown content with the same rules discovery uses. */
export function validateMarkdownContent(
  kind: MarkdownKind,
  content: string,
  path: string
): ValidationResult {
  const parsed = parseFrontmatter(content)
  const diagnostics: Diagnostic[] = parsed.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    path
  }))
  const parseFailed = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  if (!parseFailed) {
    if (kind === 'agents' || kind === 'skills') {
      diagnostics.push(...missingFieldDiagnostics(parsed.fields, ['name', 'description'], path))
    }
    if (kind === 'commands' && content.trim() === '') {
      diagnostics.push({ severity: 'warning', message: 'Command file is empty', path })
    }
    if (kind === 'instructions' && content.trim() === '') {
      diagnostics.push({ severity: 'info', message: 'File is empty', path })
    }
  }
  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    diagnostics
  }
}

export interface McpFormFields {
  command?: string
  args?: string[]
  env?: Record<string, string>
}

/** Narrow an untyped MCP form payload; reject wrong shapes. */
export function mcpFormFields(
  fields: Record<string, unknown>,
  operation: string
): McpFormFields {
  const out: McpFormFields = {}
  const command = fields['command']
  if (command !== undefined) {
    if (typeof command !== 'string') {
      throw new AppOperationError('invalid-request', operation, 'Field command must be a string')
    }
    out.command = command
  }
  const args = fields['args']
  if (args !== undefined) {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new AppOperationError(
        'invalid-request',
        operation,
        'Field args must be an array of strings'
      )
    }
    out.args = args as string[]
  }
  const env = fields['env']
  if (env !== undefined) {
    if (
      env === null ||
      typeof env !== 'object' ||
      Array.isArray(env) ||
      Object.values(env).some((value) => typeof value !== 'string')
    ) {
      throw new AppOperationError(
        'invalid-request',
        operation,
        'Field env must map string keys to string values'
      )
    }
    out.env = env as Record<string, string>
  }
  return out
}

/** Equal string records regardless of key order. */
export function sameStringRecord(
  a: Record<string, unknown>,
  b: Record<string, string>
): boolean {
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (aKeys.join('\0') !== bKeys.join('\0')) return false
  return aKeys.every((key) => a[key] === b[key])
}
