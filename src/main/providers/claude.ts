import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  FileOperationPlan,
  ResourceChange,
  ResourceDraft,
  ValidationResult
} from '../../shared/resource'
import { AppOperationError } from '../errors'
import { applyClaudeMcpFormEdit, validateClaudeMcpContent } from './claude/edit'
import { discoverClaudeAgents, parseClaudeAgent } from './claude/agents'
import { discoverClaudeCommands, parseClaudeCommand } from './claude/commands'
import { discoverClaudeMcpServers, parseClaudeMcpServer } from './claude/mcp-servers'
import type { AdapterOptions } from './codex'
import { applyMarkdownFormEdit, validateMarkdownContent } from './shared/edit'
import { discoverInstructionsFile, parseInstructions } from './shared/instructions'
import { decodeResourceId, type ResourceRef } from './shared/resource-id'
import { readTextFile } from './shared/scan'
import { discoverSkills, parseSkill } from './shared/skills'
import type { ProviderAdapter } from './types'

export interface ClaudeAdapterOptions extends AdapterOptions {
  /** The shared user-scope MCP config (~/.claude.json), overridable in tests. */
  userMcpPath?: string
}

function planContent(
  ref: ResourceRef,
  raw: string,
  draft: ResourceDraft,
  operation: string
): string {
  if (draft.raw !== undefined) {
    if (ref.kind === 'mcp-servers') {
      throw new AppOperationError(
        'invalid-request',
        operation,
        'MCP server entries are form-edited only in Milestone 3'
      )
    }
    return draft.raw
  }
  switch (ref.kind) {
    case 'agents':
    case 'skills':
    case 'commands':
    case 'instructions':
      return applyMarkdownFormEdit(raw, ref.kind, draft.fields, draft.body, operation)
    case 'mcp-servers': {
      if (ref.entryKey === undefined) {
        throw new AppOperationError(
          'invalid-request',
          operation,
          'Cannot edit a malformed MCP configuration'
        )
      }
      return applyClaudeMcpFormEdit(raw, ref.entryKey, draft.fields, operation)
    }
    default:
      throw new AppOperationError('invalid-request', operation, `Unknown resource kind: ${ref.kind}`)
  }
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
    async validate(draft): Promise<ValidationResult> {
      const path = draft.sourcePath ?? ''
      if (draft.raw === undefined) {
        return {
          ok: false,
          diagnostics: [{ severity: 'error', message: 'Draft has no planned content' }]
        }
      }
      switch (draft.kind) {
        case 'agents':
        case 'skills':
        case 'commands':
        case 'instructions':
          return validateMarkdownContent(draft.kind, draft.raw, path)
        case 'mcp-servers':
          return draft.entryKey === undefined
            ? {
                ok: false,
                diagnostics: [
                  { severity: 'error', message: 'Cannot validate a malformed MCP configuration' }
                ]
              }
            : validateClaudeMcpContent(draft.raw, draft.entryKey, path)
        default:
          return {
            ok: false,
            diagnostics: [{ severity: 'error', message: `Unknown resource kind: ${draft.kind}` }]
          }
      }
    },
    async plan(change: ResourceChange): Promise<FileOperationPlan> {
      if (change.kind !== 'update') {
        throw new AppOperationError('not-implemented', 'claude:plan', 'Arrives in Milestone 4.')
      }
      if (!change.resourceId || !change.draft) {
        throw new AppOperationError(
          'invalid-request',
          'claude:plan',
          'Update needs a resource id and a draft'
        )
      }
      const ref = decodeResourceId(change.resourceId)
      const raw = readTextFile(ref.path)
      if (raw === null) {
        throw new AppOperationError(
          'not-found',
          'claude:plan',
          `Source file could not be read: ${ref.path}`,
          { path: ref.path }
        )
      }
      const content = planContent(ref, raw, change.draft, 'claude:plan')
      return { operations: [{ kind: 'write', path: ref.path, content }] }
    }
  }
}
