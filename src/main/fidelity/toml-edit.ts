import { parseTOML } from 'toml-eslint-parser'

interface TomlKeySegment {
  type: string
  name?: string
  value?: string | number
}

interface TomlAstNode {
  type: string
  range: [number, number]
  key?: { keys: TomlKeySegment[] }
  value?: { range: [number, number] }
  body?: TomlAstNode[]
}

export class TomlKeyNotFoundError extends Error {
  constructor(path: Array<string | number>) {
    super(`TOML key not found: ${path.join('.')}`)
    this.name = 'TomlKeyNotFoundError'
  }
}

function keySegments(key: { keys: TomlKeySegment[] }): string[] {
  return key.keys.map((segment) =>
    segment.type === 'TOMLBare' ? String(segment.name) : String(segment.value)
  )
}

function findValueRange(
  source: string,
  path: Array<string | number>
): [number, number] | null {
  const program = parseTOML(source) as unknown as { body: TomlAstNode[] }
  const topLevel = program.body[0]
  if (!topLevel?.body) return null
  const target = path.map(String).join('\0')

  let found: [number, number] | null = null
  const walk = (body: TomlAstNode[], prefix: string[]): void => {
    for (const node of body) {
      if (node.type === 'TOMLKeyValue' && node.key && node.value) {
        const full = [...prefix, ...keySegments(node.key)]
        if (full.join('\0') === target) found = node.value.range
      } else if (node.type === 'TOMLTable' && node.key && node.body) {
        walk(node.body, keySegments(node.key))
      }
    }
  }
  walk(topLevel.body, [])
  return found
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
  const range = findValueRange(source, path)
  if (!range) throw new TomlKeyNotFoundError(path)
  return source.slice(0, range[0]) + newValueToml + source.slice(range[1])
}
