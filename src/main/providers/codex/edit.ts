import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'
import type { Diagnostic, ValidationResult } from '../../../shared/resource'
import { AppOperationError } from '../../errors'
import {
  deleteTomlKey,
  editTomlValue,
  hasTomlKeyValue,
  hasTomlTable,
  serializeTomlValue,
  setTomlValue
} from '../../fidelity/toml-edit'
import { missingFieldDiagnostics, stringField } from '../shared/document'
import { mcpFormFields, sameStringRecord, stringFields } from '../shared/edit'

function staticTable(source: string): Record<string, unknown> | null {
  try {
    const value: unknown = getStaticTOMLValue(parseTOML(source))
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Form edit of a Codex agent: top-level string fields, changed keys only. */
export function applyCodexAgentFormEdit(
  source: string,
  fields: Record<string, unknown>,
  operation: string
): string {
  const editable = stringFields(fields, ['name', 'description', 'developer_instructions'], operation)
  const current = staticTable(source)
  if (current === null) {
    throw new AppOperationError(
      'invalid-request',
      operation,
      'Cannot form-edit an unparseable TOML file; fix the source first'
    )
  }
  let out = source
  for (const [key, value] of Object.entries(editable)) {
    if (current[key] === value) continue
    out = setTomlValue(out, [], key, value)
  }
  return out
}

function applyEnvEdit(
  source: string,
  entryPath: string[],
  currentEntry: Record<string, unknown>,
  env: Record<string, string>
): string {
  const envPath = [...entryPath, 'env']
  const current = record(currentEntry['env']) ?? {}
  if (sameStringRecord(current, env)) return source
  if (hasTomlKeyValue(source, envPath)) {
    // Inline env table: replace the whole value span (comments inside it are
    // lost; everything outside the span is untouched by construction).
    return editTomlValue(source, envPath, serializeTomlValue(env))
  }
  if (hasTomlTable(source, envPath)) {
    let out = source
    for (const key of Object.keys(current)) {
      if (!(key in env)) out = deleteTomlKey(out, envPath, key)
    }
    for (const [key, value] of Object.entries(env)) {
      if (current[key] !== value) out = setTomlValue(out, envPath, key, value)
    }
    return out
  }
  return setTomlValue(source, entryPath, 'env', env)
}

/** Form edit of one MCP server entry in config.toml. */
export function applyCodexMcpFormEdit(
  source: string,
  entryKey: string,
  fields: Record<string, unknown>,
  operation: string
): string {
  const form = mcpFormFields(fields, operation)
  const servers = record(staticTable(source)?.['mcp_servers'])
  const entry = record(servers?.[entryKey])
  if (!entry) {
    throw new AppOperationError('not-found', operation, `MCP server entry not found: ${entryKey}`)
  }
  const entryPath = ['mcp_servers', entryKey]
  let out = source
  // An empty command is skipped rather than written: url-only remote servers
  // legitimately have no command, and `command = ""` would be worse.
  if (form.command !== undefined && form.command !== '' && form.command !== entry['command']) {
    out = setTomlValue(out, entryPath, 'command', form.command)
  }
  if (
    form.args !== undefined &&
    JSON.stringify(form.args) !== JSON.stringify(entry['args'] ?? [])
  ) {
    out = setTomlValue(out, entryPath, 'args', form.args)
  }
  if (form.env !== undefined) {
    out = applyEnvEdit(out, entryPath, entry, form.env)
  }
  return out
}

/** Validate proposed Codex agent TOML content. */
export function validateCodexAgentContent(content: string, path: string): ValidationResult {
  const diagnostics: Diagnostic[] = []
  let fields: Record<string, unknown> = {}
  try {
    fields = record(getStaticTOMLValue(parseTOML(content))) ?? {}
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
  return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics }
}

/** Validate a proposed config.toml against one MCP server entry. */
export function validateCodexMcpContent(
  content: string,
  entryKey: string,
  path: string
): ValidationResult {
  const diagnostics: Diagnostic[] = []
  let entry: Record<string, unknown> | null = null
  try {
    const servers = record(record(getStaticTOMLValue(parseTOML(content)))?.['mcp_servers'])
    entry = record(servers?.[entryKey])
    if (!entry) {
      diagnostics.push({
        severity: 'error',
        message: `Server entry not present: ${entryKey}`,
        path
      })
    }
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      message: `Invalid TOML: ${error instanceof Error ? error.message : String(error)}`,
      path
    })
  }
  if (entry) {
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
