import { parseDocument } from 'yaml'

export interface AgentFormModel {
  name: string
  description: string
}

interface SplitDocument {
  frontmatter: string
  body: string
}

function split(source: string): SplitDocument {
  if (!source.startsWith('---\n')) {
    throw new Error('agent markdown must start with YAML frontmatter')
  }
  const end = source.indexOf('\n---\n', 3)
  if (end === -1) throw new Error('unterminated YAML frontmatter')
  return {
    frontmatter: source.slice(4, end + 1),
    body: source.slice(end + 5)
  }
}

function reassemble(parts: SplitDocument): string {
  return `---\n${parts.frontmatter}---\n${parts.body}`
}

export function toFormModel(source: string): AgentFormModel {
  const doc = parseDocument(split(source).frontmatter)
  return {
    name: String(doc.get('name') ?? ''),
    description: String(doc.get('description') ?? '')
  }
}

/**
 * Write form fields back into the frontmatter. Untouched fields, unknown
 * fields, comments, and the Markdown body are preserved. A no-op model
 * returns the source unchanged.
 */
export function applyFormModel(source: string, model: AgentFormModel): string {
  const parts = split(source)
  const doc = parseDocument(parts.frontmatter)
  let changed = false
  if (String(doc.get('name') ?? '') !== model.name) {
    doc.set('name', model.name)
    changed = true
  }
  if (String(doc.get('description') ?? '') !== model.description) {
    doc.set('description', model.description)
    changed = true
  }
  if (!changed) return source
  return reassemble({ frontmatter: String(doc), body: parts.body })
}
