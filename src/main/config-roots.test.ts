import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfigRoots } from './config-roots'

describe('resolveConfigRoots', () => {
  it('uses the existing home-directory defaults when no overrides are set', () => {
    expect(resolveConfigRoots({})).toEqual({
      codexRoot: join(homedir(), '.codex'),
      claudeRoot: join(homedir(), '.claude'),
      claudeJson: join(homedir(), '.claude.json')
    })
  })

  it('uses environment overrides when they are set', () => {
    expect(
      resolveConfigRoots({
        AC_CODEX_ROOT: '/fixtures/codex',
        AC_CLAUDE_ROOT: '/fixtures/claude',
        AC_CLAUDE_JSON: '/fixtures/claude.json'
      })
    ).toEqual({
      codexRoot: '/fixtures/codex',
      claudeRoot: '/fixtures/claude',
      claudeJson: '/fixtures/claude.json'
    })
  })
})
