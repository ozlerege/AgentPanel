import type { ProviderId, ResourceCreateDraft, ResourceDocument } from '@shared/resource'

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

export interface EnvRow {
  key: string
  value: string
}

export interface CreateDraftInput {
  provider: ProviderId
  kind: string
  scope: 'user' | 'project'
  projectId?: string
  name: string
  description?: string
  body?: string
  developerInstructions?: string
  command?: string
  argsText?: string
  envRows?: EnvRow[]
  raw?: string
}

export function parseArgsText(argsText: string): string[] {
  return argsText
    .split('\n')
    .map((arg) => arg.trim())
    .filter((arg) => arg !== '')
}

export function parseEnvRows(envRows: EnvRow[]): Record<string, string> {
  return Object.fromEntries(
    envRows
      .map((row) => ({ key: row.key.trim(), value: row.value }))
      .filter((row) => row.key !== '')
      .map((row) => [row.key, row.value])
  )
}

export function buildResourceCreateDraft(input: CreateDraftInput): ResourceCreateDraft {
  let fields: Record<string, unknown> = {}
  let body: string | undefined = input.body
  if (input.kind === 'mcp-servers') {
    fields = {
      command: input.command ?? '',
      args: parseArgsText(input.argsText ?? ''),
      env: parseEnvRows(input.envRows ?? [])
    }
    body = undefined
  } else if (input.provider === 'codex' && input.kind === 'agents') {
    fields = {
      description: input.description ?? '',
      developer_instructions: input.developerInstructions ?? ''
    }
    body = undefined
  } else if (input.kind === 'instructions') {
    fields = {}
  } else {
    fields = { description: input.description ?? '' }
  }
  const draft: ResourceCreateDraft = {
    provider: input.provider,
    kind: input.kind,
    scope: input.scope,
    name: input.name,
    fields
  }
  if (input.scope === 'project' && input.projectId !== undefined) draft.projectId = input.projectId
  if (body !== undefined) draft.body = body
  if (input.raw !== undefined) draft.raw = input.raw
  return draft
}
