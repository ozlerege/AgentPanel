import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changedLineNumbers } from '../../../tests/helpers/diff'
import { editJsonValue } from './jsonc-edit'

const fixture = readFileSync(
  join(import.meta.dirname, '../../../tests/fixtures/claude/settings.json'),
  'utf8'
)

describe('editJsonValue', () => {
  it('edits one hook command without touching the other hook', () => {
    const result = editJsonValue(
      fixture,
      ['hooks', 'PostToolUse', 1, 'hooks', 0, 'command'],
      'bun run lint --fix'
    )
    expect(result).toContain('"command": "bun run lint --fix"')
    expect(result).toContain('"command": "echo ran-bash"')
    expect(changedLineNumbers(fixture, result)).toHaveLength(1)
  })

  it('preserves comments and unknown fields', () => {
    const result = editJsonValue(fixture, ['env', 'CLAUDE_CODE_ENABLE_TELEMETRY'], '1')
    expect(result).toContain('// User settings for Claude Code')
    expect(result).toContain('"unknownFutureSetting": { "keep": true }')
  })

  it('is byte-identical outside the edited region', () => {
    const result = editJsonValue(
      fixture,
      ['env', 'CLAUDE_CODE_ENABLE_TELEMETRY'],
      '1'
    )
    const expected = fixture.replace(
      '"CLAUDE_CODE_ENABLE_TELEMETRY": "0"',
      '"CLAUDE_CODE_ENABLE_TELEMETRY": "1"'
    )
    expect(result).toBe(expected)
  })
})
