import { parseTOML } from 'toml-eslint-parser'

interface TomlKeySegment {
  type: string
  name?: string
  value?: string | number
}

interface TomlAstNode {
  type: string
  range: [number, number]
  key?: { keys: TomlKeySegment[]; range: [number, number] }
  value?: { range: [number, number] }
  body?: TomlAstNode[]
}

export class TomlKeyNotFoundError extends Error {
  constructor(path: Array<string | number>) {
    super(`TOML key not found: ${path.join('.')}`)
    this.name = 'TomlKeyNotFoundError'
  }
}

export class TomlTableNotFoundError extends Error {
  constructor(path: Array<string | number>) {
    super(`TOML table not found: ${path.join('.')}`)
    this.name = 'TomlTableNotFoundError'
  }
}

export class TomlTableExistsError extends Error {
  constructor(path: Array<string | number>) {
    super(`TOML table already exists: ${path.join('.')}`)
    this.name = 'TomlTableExistsError'
  }
}

export type TomlValue = string | number | boolean | string[] | Record<string, string>

function keySegments(key: { keys: TomlKeySegment[] }): string[] {
  return key.keys.map((segment) =>
    segment.type === 'TOMLBare' ? String(segment.name) : String(segment.value)
  )
}

function topLevel(source: string): TomlAstNode | undefined {
  const program = parseTOML(source) as unknown as { body: TomlAstNode[] }
  return program.body[0]
}

function findKeyValueNode(source: string, path: Array<string | number>): TomlAstNode | null {
  const root = topLevel(source)
  if (!root?.body) return null
  const target = path.map(String).join('\0')
  let found: TomlAstNode | null = null
  const walk = (body: TomlAstNode[], prefix: string[]): void => {
    for (const node of body) {
      if (node.type === 'TOMLKeyValue' && node.key && node.value) {
        const full = [...prefix, ...keySegments(node.key)]
        if (full.join('\0') === target) found = node
      } else if (node.type === 'TOMLTable' && node.key && node.body) {
        walk(node.body, keySegments(node.key))
      }
    }
  }
  walk(root.body, [])
  return found
}

interface TableTarget {
  /** Nodes directly inside the table (for the root, key-values AND tables). */
  body: TomlAstNode[]
  /** Offset just past the table header line; 0 for the root table. */
  headerEnd: number
}

function findTable(source: string, tablePath: Array<string | number>): TableTarget | null {
  const root = topLevel(source)
  if (!root?.body) return null
  if (tablePath.length === 0) return { body: root.body, headerEnd: 0 }
  const target = tablePath.map(String).join('\0')
  for (const node of root.body) {
    if (node.type === 'TOMLTable' && node.key && node.body) {
      if (keySegments(node.key).join('\0') === target) {
        const headerLineEnd = source.indexOf('\n', node.key.range[1])
        return {
          body: node.body,
          headerEnd: headerLineEnd === -1 ? source.length : headerLineEnd + 1
        }
      }
    }
  }
  return null
}

/** Offset at which a new `key = value` line is inserted for the table. */
function insertionOffset(source: string, table: TableTarget): number {
  const keyValues = table.body.filter((node) => node.type === 'TOMLKeyValue')
  const last = keyValues[keyValues.length - 1]
  if (!last) return table.headerEnd
  const lineEnd = source.indexOf('\n', last.range[1])
  return lineEnd === -1 ? source.length : lineEnd + 1
}

function escapeTomlString(value: string): string {
  return (
    '"' +
    value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t') +
    '"'
  )
}

function bareOrQuotedKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : escapeTomlString(key)
}

function tableHeader(tablePath: Array<string | number>): string {
  return `[${tablePath.map((segment) => bareOrQuotedKey(String(segment))).join('.')}]\n`
}

export function serializeTomlValue(value: TomlValue): string {
  if (typeof value === 'string') return escapeTomlString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(escapeTomlString).join(', ')}]`
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  return `{ ${entries
    .map(([key, entry]) => `${bareOrQuotedKey(key)} = ${escapeTomlString(entry)}`)
    .join(', ')} }`
}

export function hasTomlKeyValue(source: string, path: Array<string | number>): boolean {
  return findKeyValueNode(source, path) !== null
}

export function hasTomlTable(source: string, tablePath: Array<string | number>): boolean {
  return findTable(source, tablePath) !== null
}

/**
 * Replace exactly the byte range of the value at `path` with `newValueToml`
 * (a pre-serialized TOML literal, e.g. '"never"' or '42'). Everything outside
 * the value's range is untouched by construction.
 */
export function editTomlValue(
  source: string,
  path: Array<string | number>,
  newValueToml: string
): string {
  const node = findKeyValueNode(source, path)
  if (!node?.value) throw new TomlKeyNotFoundError(path)
  return source.slice(0, node.value.range[0]) + newValueToml + source.slice(node.value.range[1])
}

/**
 * Set `key` inside the table at `tablePath`: replace the existing value span,
 * or insert a new `key = value` line after the table's last key-value.
 */
export function setTomlValue(
  source: string,
  tablePath: Array<string | number>,
  key: string,
  value: TomlValue
): string {
  const serialized = serializeTomlValue(value)
  const existing = findKeyValueNode(source, [...tablePath, key])
  if (existing?.value) {
    return (
      source.slice(0, existing.value.range[0]) + serialized + source.slice(existing.value.range[1])
    )
  }
  const table = findTable(source, tablePath)
  if (!table) throw new TomlTableNotFoundError(tablePath)
  const offset = insertionOffset(source, table)
  const needsLeadingNewline = offset === source.length && source.length > 0 && !source.endsWith('\n')
  const line = `${bareOrQuotedKey(key)} = ${serialized}\n`
  return source.slice(0, offset) + (needsLeadingNewline ? '\n' : '') + line + source.slice(offset)
}

export function appendTomlTable(
  source: string,
  tablePath: Array<string | number>,
  keyValues: Array<[string, TomlValue]>
): string {
  if (hasTomlTable(source, tablePath) || hasTomlKeyValue(source, tablePath)) {
    throw new TomlTableExistsError(tablePath)
  }
  const prefix = source.length === 0 ? '' : source.endsWith('\n') ? '\n' : '\n\n'
  const body = keyValues
    .map(([key, value]) => `${bareOrQuotedKey(key)} = ${serializeTomlValue(value)}\n`)
    .join('')
  return `${source}${prefix}${tableHeader(tablePath)}${body}`
}

function isDescendantTable(
  candidate: Array<string | number>,
  parent: Array<string | number>
): boolean {
  return (
    candidate.length > parent.length &&
    parent.every((segment, index) => String(candidate[index]) === String(segment))
  )
}

export function deleteTomlTable(source: string, tablePath: Array<string | number>): string {
  const root = topLevel(source)
  if (!root?.body) throw new TomlTableNotFoundError(tablePath)
  const tables = root.body.filter((node) => node.type === 'TOMLTable' && node.key)
  const index = tables.findIndex(
    (node) => node.key && keySegments(node.key).join('\0') === tablePath.map(String).join('\0')
  )
  if (index === -1) throw new TomlTableNotFoundError(tablePath)
  const target = tables[index]
  const start = source.lastIndexOf('\n', target.range[0] - 1) + 1
  let end = source.length
  for (const next of tables.slice(index + 1)) {
    if (!next.key || isDescendantTable(keySegments(next.key), tablePath)) continue
    end = source.lastIndexOf('\n', next.range[0] - 1) + 1
    break
  }
  return source.slice(0, start) + source.slice(end)
}

/** Remove the whole line of `key` in the table at `tablePath` (incl. trailing comment). */
export function deleteTomlKey(
  source: string,
  tablePath: Array<string | number>,
  key: string
): string {
  const node = findKeyValueNode(source, [...tablePath, key])
  if (!node) throw new TomlKeyNotFoundError([...tablePath, key])
  const lineStart = source.lastIndexOf('\n', node.range[0] - 1) + 1
  const lineEnd = source.indexOf('\n', node.range[1])
  return source.slice(0, lineStart) + (lineEnd === -1 ? '' : source.slice(lineEnd + 1))
}
