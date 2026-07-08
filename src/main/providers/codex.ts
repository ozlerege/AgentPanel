import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AppOperationError } from '../errors'
import { discoverCodexAgents, parseCodexAgent } from './codex/agents'
import { discoverCodexMcpServers, parseCodexMcpServer } from './codex/mcp-servers'
import { discoverInstructionsFile, parseInstructions } from './shared/instructions'
import { discoverSkills, parseSkill } from './shared/skills'
import type { ProviderAdapter } from './types'

export interface AdapterOptions {
  configRoot?: string
}

function notImplemented(operation: string): never {
  throw new AppOperationError('not-implemented', operation, 'Editing arrives in Milestone 3.')
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
          { id: 'mcp-servers', label: 'MCP Servers' },
          { id: 'instructions', label: 'Instructions' }
        ]
      }
    },
    async discover(context) {
      return [
        ...discoverCodexAgents(join(configRoot, 'agents'), {
          provider: 'codex',
          scope: 'user'
        }),
        ...discoverSkills(join(configRoot, 'skills'), {
          provider: 'codex',
          scope: 'user'
        }),
        ...discoverCodexMcpServers(configRoot),
        ...discoverInstructionsFile(join(configRoot, 'AGENTS.md'), {
          provider: 'codex',
          scope: 'user'
        }),
        ...context.projects.flatMap((project) =>
          discoverInstructionsFile(join(project.path, 'AGENTS.md'), {
            provider: 'codex',
            scope: 'project',
            projectId: project.id
          })
        )
      ]
    },
    async parse(source) {
      switch (source.kind) {
        case 'agents':
          return parseCodexAgent(source)
        case 'skills':
          return parseSkill(source)
        case 'mcp-servers':
          return parseCodexMcpServer(source)
        case 'instructions':
          return parseInstructions(source)
        default:
          throw new AppOperationError(
            'invalid-request',
            'codex:parse',
            `Unknown resource kind: ${source.kind}`
          )
      }
    },
    async validate() {
      return notImplemented('codex:validate')
    },
    async plan() {
      return notImplemented('codex:plan')
    }
  }
}
