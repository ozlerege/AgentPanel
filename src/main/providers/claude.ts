import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AppOperationError } from '../errors'
import { discoverClaudeAgents, parseClaudeAgent } from './claude/agents'
import { discoverClaudeCommands, parseClaudeCommand } from './claude/commands'
import { discoverClaudeMcpServers, parseClaudeMcpServer } from './claude/mcp-servers'
import type { AdapterOptions } from './codex'
import { discoverInstructionsFile, parseInstructions } from './shared/instructions'
import { discoverSkills, parseSkill } from './shared/skills'
import type { ProviderAdapter } from './types'

export interface ClaudeAdapterOptions extends AdapterOptions {
  /** The shared user-scope MCP config (~/.claude.json), overridable in tests. */
  userMcpPath?: string
}

function notImplemented(operation: string): never {
  throw new AppOperationError('not-implemented', operation, 'Editing arrives in Milestone 3.')
}

export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): ProviderAdapter {
  const configRoot = options.configRoot ?? join(homedir(), '.claude')
  const userMcpPath = options.userMcpPath ?? join(homedir(), '.claude.json')
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
          { id: 'commands', label: 'Commands' },
          { id: 'mcp-servers', label: 'MCP Servers' },
          { id: 'instructions', label: 'Instructions' }
        ]
      }
    },
    async discover(context) {
      const user = { provider: 'claude' as const, scope: 'user' as const }
      const forProject = (id: string) => ({
        provider: 'claude' as const,
        scope: 'project' as const,
        projectId: id
      })
      return [
        ...discoverClaudeAgents(join(configRoot, 'agents'), user),
        ...context.projects.flatMap((project) =>
          discoverClaudeAgents(join(project.path, '.claude', 'agents'), forProject(project.id))
        ),
        ...discoverSkills(join(configRoot, 'skills'), user),
        ...context.projects.flatMap((project) =>
          discoverSkills(join(project.path, '.claude', 'skills'), forProject(project.id))
        ),
        ...discoverClaudeCommands(join(configRoot, 'commands'), user),
        ...context.projects.flatMap((project) =>
          discoverClaudeCommands(join(project.path, '.claude', 'commands'), forProject(project.id))
        ),
        ...discoverClaudeMcpServers(userMcpPath, context.projects),
        ...discoverInstructionsFile(join(configRoot, 'CLAUDE.md'), user),
        ...context.projects.flatMap((project) =>
          discoverInstructionsFile(join(project.path, 'CLAUDE.md'), forProject(project.id))
        )
      ]
    },
    async parse(source) {
      switch (source.kind) {
        case 'agents':
          return parseClaudeAgent(source)
        case 'skills':
          return parseSkill(source)
        case 'commands':
          return parseClaudeCommand(source)
        case 'mcp-servers':
          return parseClaudeMcpServer(source)
        case 'instructions':
          return parseInstructions(source)
        default:
          throw new AppOperationError(
            'invalid-request',
            'claude:parse',
            `Unknown resource kind: ${source.kind}`
          )
      }
    },
    async validate() {
      return notImplemented('claude:validate')
    },
    async plan() {
      return notImplemented('claude:plan')
    }
  }
}
