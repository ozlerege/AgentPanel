import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ConfigRoots {
  codexRoot: string
  claudeRoot: string
  claudeJson: string
}

export function resolveConfigRoots(env: NodeJS.ProcessEnv): ConfigRoots {
  const home = homedir()
  return {
    codexRoot: env['AC_CODEX_ROOT'] ?? join(home, '.codex'),
    claudeRoot: env['AC_CLAUDE_ROOT'] ?? join(home, '.claude'),
    claudeJson: env['AC_CLAUDE_JSON'] ?? join(home, '.claude.json')
  }
}
