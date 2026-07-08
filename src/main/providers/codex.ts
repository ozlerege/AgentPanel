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
import {
  applyCodexAgentFormEdit,
  applyCodexMcpFormEdit,
  validateCodexAgentContent,
  validateCodexMcpContent
} from './codex/edit'
import { discoverCodexAgents, parseCodexAgent } from './codex/agents'
import { discoverCodexMcpServers, parseCodexMcpServer } from './codex/mcp-servers'
import { applyMarkdownFormEdit, validateMarkdownContent } from './shared/edit'
import { discoverInstructionsFile, parseInstructions } from './shared/instructions'
import { decodeResourceId, type ResourceRef } from './shared/resource-id'
import { readTextFile } from './shared/scan'
import { discoverSkills, parseSkill } from './shared/skills'
import type { ProviderAdapter } from './types'

export interface AdapterOptions {
  configRoot?: string
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
      return applyCodexAgentFormEdit(raw, draft.fields, operation)
    case 'skills':
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
      return applyCodexMcpFormEdit(raw, ref.entryKey, draft.fields, operation)
    }
    default:
      throw new AppOperationError('invalid-request', operation, `Unknown resource kind: ${ref.kind}`)
  }
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
          return validateCodexAgentContent(draft.raw, path)
        case 'skills':
          return validateMarkdownContent('skills', draft.raw, path)
        case 'instructions':
          return validateMarkdownContent('instructions', draft.raw, path)
        case 'mcp-servers':
          return draft.entryKey === undefined
            ? {
                ok: false,
                diagnostics: [
                  { severity: 'error', message: 'Cannot validate a malformed MCP configuration' }
                ]
              }
            : validateCodexMcpContent(draft.raw, draft.entryKey, path)
        default:
          return {
            ok: false,
            diagnostics: [{ severity: 'error', message: `Unknown resource kind: ${draft.kind}` }]
          }
      }
    },
    async plan(change: ResourceChange): Promise<FileOperationPlan> {
      if (change.kind !== 'update') {
        throw new AppOperationError('not-implemented', 'codex:plan', 'Arrives in Milestone 4.')
      }
      if (!change.resourceId || !change.draft) {
        throw new AppOperationError(
          'invalid-request',
          'codex:plan',
          'Update needs a resource id and a draft'
        )
      }
      const ref = decodeResourceId(change.resourceId)
      const raw = readTextFile(ref.path)
      if (raw === null) {
        throw new AppOperationError(
          'not-found',
          'codex:plan',
          `Source file could not be read: ${ref.path}`,
          { path: ref.path }
        )
      }
      const content = planContent(ref, raw, change.draft, 'codex:plan')
      return { operations: [{ kind: 'write', path: ref.path, content }] }
    }
  }
}
