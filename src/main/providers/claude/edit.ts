import { parse, type ParseError } from 'jsonc-parser'
import type { Diagnostic, ValidationResult } from '../../../shared/resource'
import { AppOperationError } from '../../errors'
import { editJsonValue } from '../../fidelity/jsonc-edit'
import { stringField } from '../shared/document'
import { mcpFormFields, sameStringRecord } from '../shared/edit'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseConfig(content: string): { config: Record<string, unknown> | null; broken: boolean } {
  const errors: ParseError[] = []
  const value: unknown = parse(content, errors, { allowTrailingComma: true })
  if (errors.length > 0) return { config: null, broken: true }
  return { config: record(value), broken: false }
}

/** Form edit of one MCP server entry in ~/.claude.json or <project>/.mcp.json. */
export function applyClaudeMcpFormEdit(
  source: string,
  entryKey: string,
  fields: Record<string, unknown>,
  operation: string
): string {
  const form = mcpFormFields(fields, operation)
  const { config, broken } = parseConfig(source)
  if (broken || config === null) {
    throw new AppOperationError(
      'invalid-request',
      operation,
      'Cannot form-edit a malformed JSON file; fix the source first'
    )
  }
  const entry = record(record(config['mcpServers'])?.[entryKey])
  if (!entry) {
    throw new AppOperationError('not-found', operation, `MCP server entry not found: ${entryKey}`)
  }
  let out = source
  // An empty command is skipped rather than written (url-only remote servers).
  if (form.command !== undefined && form.command !== '' && form.command !== entry['command']) {
    out = editJsonValue(out, ['mcpServers', entryKey, 'command'], form.command)
  }
  if (
    form.args !== undefined &&
    JSON.stringify(form.args) !== JSON.stringify(entry['args'] ?? [])
  ) {
    out = editJsonValue(out, ['mcpServers', entryKey, 'args'], form.args)
  }
  if (form.env !== undefined) {
    const currentEnv = record(entry['env']) ?? {}
    if (!sameStringRecord(currentEnv, form.env)) {
      const empty = Object.keys(form.env).length === 0
      if (empty && entry['env'] === undefined) {
        // nothing to remove
      } else {
        // undefined value removes the property (jsonc-parser modify semantics)
        out = editJsonValue(out, ['mcpServers', entryKey, 'env'], empty ? undefined : form.env)
      }
    }
  }
  return out
}

export function createClaudeMcpEntry(
  source: string,
  entryKey: string,
  fields: Record<string, unknown>,
  operation: string
): string {
  const form = mcpFormFields(fields, operation)
  if (form.command === undefined || form.command.trim() === '') {
    throw new AppOperationError('invalid-request', operation, 'MCP server command is required')
  }
  const { config, broken } = parseConfig(source)
  if (broken || config === null) {
    throw new AppOperationError(
      'invalid-request',
      operation,
      'Cannot create an MCP entry in a malformed JSON file; fix the source first'
    )
  }
  if (record(record(config['mcpServers'])?.[entryKey])) {
    throw new AppOperationError('conflict', operation, `MCP server entry already exists: ${entryKey}`)
  }
  const entry: Record<string, unknown> = { command: form.command }
  if (form.args !== undefined) entry['args'] = form.args
  if (form.env !== undefined) entry['env'] = form.env
  return editJsonValue(source, ['mcpServers', entryKey], entry)
}

export function deleteClaudeMcpEntry(
  source: string,
  entryKey: string,
  operation: string
): string {
  const { config, broken } = parseConfig(source)
  if (broken || config === null) {
    throw new AppOperationError(
      'invalid-request',
      operation,
      'Cannot delete an MCP entry in a malformed JSON file; fix the source first'
    )
  }
  if (!record(record(config['mcpServers'])?.[entryKey])) {
    throw new AppOperationError('not-found', operation, `MCP server entry not found: ${entryKey}`)
  }
  return editJsonValue(source, ['mcpServers', entryKey], undefined)
}

/** Validate a proposed MCP config file against one server entry. */
export function validateClaudeMcpContent(
  content: string,
  entryKey: string,
  path: string
): ValidationResult {
  const diagnostics: Diagnostic[] = []
  const { config, broken } = parseConfig(content)
  const entry = broken ? null : record(record(config?.['mcpServers'])?.[entryKey])
  if (broken) {
    diagnostics.push({ severity: 'error', message: 'Invalid JSON', path })
  } else if (!entry) {
    diagnostics.push({
      severity: 'error',
      message: `Server entry not present: ${entryKey}`,
      path
    })
  } else {
    if (stringField(entry, 'command') === undefined && stringField(entry, 'url') === undefined) {
      diagnostics.push({
        severity: 'error',
        message: 'Server needs a command (or url for remote servers)',
        path
      })
    }
    const args = entry['args']
    if (args !== undefined && (!Array.isArray(args) || args.some((a) => typeof a !== 'string'))) {
      diagnostics.push({ severity: 'error', message: 'args must be an array of strings', path })
    }
    const env = entry['env']
    if (
      env !== undefined &&
      (record(env) === null || Object.values(record(env) ?? {}).some((v) => typeof v !== 'string'))
    ) {
      diagnostics.push({
        severity: 'error',
        message: 'env must map string keys to string values',
        path
      })
    }
  }
  return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics }
}
