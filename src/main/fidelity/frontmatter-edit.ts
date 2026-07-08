import { parseDocument } from 'yaml'

export interface FrontmatterEdit {
  /** Frontmatter keys to set. Only the provided keys are touched. */
  fields?: Record<string, string>
  /** Replacement for everything after the frontmatter block. */
  body?: string
}

interface SplitDocument {
  /** Raw frontmatter text (without the --- fences), or null when absent. */
  frontmatter: string | null
  body: string
}

function split(source: string): SplitDocument {
  if (!source.startsWith('---\n')) return { frontmatter: null, body: source }
  const close = source.indexOf('\n---\n', 3)
  if (close !== -1) {
    return { frontmatter: source.slice(4, close + 1), body: source.slice(close + 5) }
  }
  if (source.endsWith('\n---')) {
    return { frontmatter: source.slice(4, source.length - 3), body: '' }
  }
  throw new Error('unterminated YAML frontmatter')
}

/**
 * Write form fields and/or a new body back into a Markdown document. Untouched
 * fields, unknown fields, and comments are preserved via the YAML Document API.
 * A no-op edit returns the source unchanged (byte-identical).
 */
export function applyFrontmatterEdit(source: string, edit: FrontmatterEdit): string {
  const parts = split(source)
  const fieldEntries = Object.entries(edit.fields ?? {})
  let frontmatter = parts.frontmatter
  let changed = false

  if (fieldEntries.length > 0) {
    const doc = parseDocument(frontmatter ?? '')
    for (const [key, value] of fieldEntries) {
      if (String(doc.get(key) ?? '') !== value) {
        doc.set(key, value)
        changed = true
      }
    }
    if (changed) frontmatter = String(doc)
  }

  const body = edit.body ?? parts.body
  if (edit.body !== undefined && edit.body !== parts.body) changed = true
  if (!changed) return source

  if (frontmatter === null) return body
  return `---\n${frontmatter}---\n${body}`
}
