import type { ResourceDocument } from '@shared/resource'

export interface TextFieldSpec {
  key: string
  label: string
  multiline: boolean
}

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/

/** The Markdown body after the frontmatter block (mirrors the main-process split). */
export function splitBody(raw: string): string {
  const match = FRONTMATTER.exec(raw)
  return match ? raw.slice(match[0].length) : raw
}

/** MCP entries live inside shared files: form-only in Milestone 3. */
export function supportsSourceEdit(doc: ResourceDocument): boolean {
  return doc.kind !== 'mcp-servers' && doc.native.raw !== undefined
}

export function hasBodyEditor(doc: ResourceDocument): boolean {
  if (doc.kind === 'mcp-servers') return false
  return !(doc.provider === 'codex' && doc.kind === 'agents')
}

export function formFieldSpecs(doc: ResourceDocument): TextFieldSpec[] {
  if (doc.kind === 'mcp-servers' || doc.kind === 'instructions') return []
  if (doc.provider === 'codex' && doc.kind === 'agents') {
    return [
      { key: 'name', label: 'Name', multiline: false },
      { key: 'description', label: 'Description', multiline: true },
      { key: 'developer_instructions', label: 'Developer instructions', multiline: true }
    ]
  }
  if (doc.kind === 'commands') {
    return [{ key: 'description', label: 'Description', multiline: true }]
  }
  return [
    { key: 'name', label: 'Name', multiline: false },
    { key: 'description', label: 'Description', multiline: true }
  ]
}

export function initialFieldValues(
  doc: ResourceDocument,
  specs: TextFieldSpec[]
): Record<string, string> {
  return Object.fromEntries(
    specs.map((spec) => {
      const value = doc.fields[spec.key]
      return [spec.key, typeof value === 'string' ? value : '']
    })
  )
}

export function initialArgs(doc: ResourceDocument): string {
  const args = doc.fields['args']
  if (!Array.isArray(args)) return ''
  return args.filter((arg): arg is string => typeof arg === 'string').join('\n')
}

export function initialEnv(doc: ResourceDocument): Array<{ key: string; value: string }> {
  const env = doc.fields['env']
  if (env === null || typeof env !== 'object' || Array.isArray(env)) return []
  return Object.entries(env)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => ({ key, value }))
}
