import { applyEdits, modify } from 'jsonc-parser'
import type { JSONPath } from 'jsonc-parser'

/**
 * Surgically set `value` at `path` in a JSON/JSONC document, preserving
 * comments, key order, and formatting everywhere else. This is the same
 * mechanism VS Code uses to edit settings.json.
 */
export function editJsonValue(
  source: string,
  path: JSONPath,
  value: unknown
): string {
  const edits = modify(source, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  })
  return applyEdits(source, edits)
}
