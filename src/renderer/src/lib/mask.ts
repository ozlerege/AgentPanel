const MASK = '••••'

const TOKEN_SHAPE = /\b(?:sk|sbp|ghp|gho|ghu|ghs|xoxb|xoxp|glpat|pat)[-_][A-Za-z0-9_-]{10,}/g
const ASSIGNMENT = /\b(token|secret|password|api[-_]?key|access[-_]?key)(\s*[=:]\s*)[^\s"']+/gi
const SECRET_KEY = /token|secret|password|credential|api[-_]?key|access[-_]?key/i

/** Mask credential-shaped substrings in display text. */
export function maskSecretText(text: string): string {
  return text.replace(TOKEN_SHAPE, MASK).replace(ASSIGNMENT, `$1$2${MASK}`)
}

/** Recursively mask a field value: by key name, then by string content. */
export function maskValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return MASK
  if (typeof value === 'string') return maskSecretText(value)
  if (Array.isArray(value)) return value.map((item) => maskValue(key, item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nested]) => [
        nestedKey,
        maskValue(nestedKey, nested)
      ])
    )
  }
  return value
}

/** Human-readable, credential-masked rendering of one resource field. */
export function formatFieldValue(key: string, value: unknown): string {
  const masked = maskValue(key, value)
  return typeof masked === 'string' ? masked : JSON.stringify(masked, null, 2)
}
