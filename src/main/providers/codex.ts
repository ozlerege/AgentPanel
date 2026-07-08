import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AppOperationError } from '../errors'
import type { ProviderAdapter } from './types'

export interface AdapterOptions {
  configRoot?: string
}

function notImplemented(operation: string): never {
  throw new AppOperationError(
    'not-implemented',
    operation,
    'Resource discovery and editing arrive in Milestone 2/3.'
  )
}

export function createCodexAdapter(options: AdapterOptions = {}): ProviderAdapter {
  const configRoot = options.configRoot ?? join(homedir(), '.codex')
  return {
    id: 'codex',
    async detect() {
      const detected = existsSync(configRoot)
      return {
        id: 'codex',
        displayName: 'Codex',
        detected,
        configRoot: detected ? configRoot : null
      }
    },
    capabilities() {
      return {
        providerId: 'codex',
        displayName: 'Codex',
        categories: [
          { id: 'agents', label: 'Agents' },
          { id: 'skills', label: 'Skills' },
          { id: 'plugins', label: 'Plugins' },
          { id: 'hooks', label: 'Hooks' },
          { id: 'mcp-servers', label: 'MCP Servers' },
          { id: 'instructions', label: 'Instructions' }
        ]
      }
    },
    async discover() {
      return notImplemented('codex:discover')
    },
    async parse() {
      return notImplemented('codex:parse')
    },
    async validate() {
      return notImplemented('codex:validate')
    },
    async plan() {
      return notImplemented('codex:plan')
    }
  }
}
