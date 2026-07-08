import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AppOperationError } from '../errors'
import type { AdapterOptions } from './codex'
import type { ProviderAdapter } from './types'

function notImplemented(operation: string): never {
  throw new AppOperationError(
    'not-implemented',
    operation,
    'Resource discovery and editing arrive in Milestone 2/3.'
  )
}

export function createClaudeAdapter(options: AdapterOptions = {}): ProviderAdapter {
  const configRoot = options.configRoot ?? join(homedir(), '.claude')
  return {
    id: 'claude',
    async detect() {
      const detected = existsSync(configRoot)
      return {
        id: 'claude',
        displayName: 'Claude Code',
        detected,
        configRoot: detected ? configRoot : null
      }
    },
    capabilities() {
      return {
        providerId: 'claude',
        displayName: 'Claude Code',
        categories: [
          { id: 'agents', label: 'Agents' },
          { id: 'skills', label: 'Skills' },
          { id: 'plugins', label: 'Plugins' },
          { id: 'commands', label: 'Commands' },
          { id: 'hooks', label: 'Hooks' },
          { id: 'mcp-servers', label: 'MCP Servers' },
          { id: 'instructions', label: 'Instructions' }
        ]
      }
    },
    async discover() {
      return notImplemented('claude:discover')
    },
    async parse() {
      return notImplemented('claude:parse')
    },
    async validate() {
      return notImplemented('claude:validate')
    },
    async plan() {
      return notImplemented('claude:plan')
    }
  }
}
