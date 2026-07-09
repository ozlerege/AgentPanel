import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import type {
  FileOperation,
  FileOperationPlan,
  ResourceChange,
  ResourceDraft,
  ValidationResult
} from '../../shared/resource'
import { AppOperationError } from '../errors'
import {
  applyClaudeMcpFormEdit,
  createClaudeMcpEntry,
  deleteClaudeMcpEntry,
  validateClaudeMcpContent
} from './claude/edit'
import { discoverClaudeAgents, parseClaudeAgent } from './claude/agents'
import { discoverClaudeCommands, parseClaudeCommand } from './claude/commands'
import { discoverClaudeMcpServers, parseClaudeMcpServer } from './claude/mcp-servers'
import type { AdapterOptions } from './codex'
import { applyFrontmatterEdit } from '../fidelity/frontmatter-edit'
import { assertEntryKey, markdownTemplate, slugifyName } from './shared/create'
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

function assertMissing(path: string, operation: string): void {
  if (existsSync(path)) {
    throw new AppOperationError('conflict', operation, `Target already exists: ${path}`, { path })
  }
}

function projectTarget(draft: ResourceDraft, operation: string): string {
  if (draft.sourcePath !== undefined) return draft.sourcePath
  throw new AppOperationError(
    'invalid-request',
    operation,
    'Project-scope create needs a target path'
  )
}

function claudeCreatePath(
  configRoot: string,
  userMcpPath: string,
  draft: ResourceDraft,
  slug: string
): string {
  if (draft.scope === 'project') return projectTarget(draft, 'claude:plan')
  switch (draft.kind) {
    case 'agents':
      return join(configRoot, 'agents', `${slug}.md`)
    case 'skills':
      return join(configRoot, 'skills', slug, 'SKILL.md')
    case 'commands':
      return join(configRoot, 'commands', `${slug}.md`)
    case 'instructions':
      return join(configRoot, 'CLAUDE.md')
    case 'mcp-servers':
      return userMcpPath
    default:
      throw new AppOperationError('invalid-request', 'claude:plan', `Unknown resource kind: ${draft.kind}`)
  }
}

function claudeCreateContent(draft: ResourceDraft): string {
  if (draft.raw !== undefined) return draft.raw
  const name = draft.name ?? ''
  const description =
    typeof draft.fields['description'] === 'string' ? draft.fields['description'] : ''
  switch (draft.kind) {
    case 'agents':
      return markdownTemplate('agents', name, description, draft.body ?? '')
    case 'skills':
      return markdownTemplate('skills', name, description, draft.body ?? '')
    case 'commands':
      return markdownTemplate('commands', name, description, draft.body ?? '')
    case 'instructions':
      return draft.body ?? ''
    default:
      throw new AppOperationError('invalid-request', 'claude:plan', `Unknown resource kind: ${draft.kind}`)
  }
}

function fileOperationsUnder(dir: string): FileOperation[] {
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
    .map((path) => ({ kind: 'delete' as const, path }))
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort((a, b) => b.length - a.length)
    .map((path) => ({ kind: 'rmdir' as const, path }))
  return [...files, ...directories, { kind: 'rmdir', path: dir }]
}

function disabledTarget(path: string, enabled: boolean): string {
  return enabled ? path.replace(/\.disabled$/, '') : `${path}.disabled`
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
          { id: 'agents', label: 'Agents', createScopes: ['user', 'project'] },
          { id: 'skills', label: 'Skills', createScopes: ['user', 'project'] },
          { id: 'commands', label: 'Commands', createScopes: ['user', 'project'] },
          { id: 'mcp-servers', label: 'MCP Servers', createScopes: ['user', 'project'] },
          { id: 'instructions', label: 'Instructions', createScopes: ['user', 'project'] }
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
      if (change.kind === 'create') {
        if (!change.draft?.name) {
          throw new AppOperationError('invalid-request', 'claude:plan', 'Create needs a draft name')
        }
        const slug = slugifyName(change.draft.name, 'claude:plan')
        const path = claudeCreatePath(configRoot, userMcpPath, change.draft, slug)
        if (change.draft.kind === 'mcp-servers') {
          const entryKey = assertEntryKey(change.draft.name, 'claude:plan')
          const source = readTextFile(path) ?? '{}'
          return {
            operations: [
              {
                kind: 'write',
                path,
                content: createClaudeMcpEntry(source, entryKey, change.draft.fields, 'claude:plan')
              }
            ]
          }
        }
        assertMissing(path, 'claude:plan')
        return { operations: [{ kind: 'write', path, content: claudeCreateContent(change.draft) }] }
      }

      if (change.kind === 'update') {
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

      if (!change.resourceId) {
        throw new AppOperationError(
          'invalid-request',
          'claude:plan',
          `${change.kind} needs a resource id`
        )
      }
      const ref = decodeResourceId(change.resourceId)

      if (change.kind === 'delete') {
        if (ref.kind === 'skills') {
          return { operations: fileOperationsUnder(dirname(ref.path)) }
        }
        if (ref.kind === 'mcp-servers') {
          if (ref.entryKey === undefined) {
            throw new AppOperationError('invalid-request', 'claude:plan', 'MCP delete needs an entry key')
          }
          const source = readTextFile(ref.path)
          if (source === null) {
            throw new AppOperationError('not-found', 'claude:plan', `Source file could not be read: ${ref.path}`, {
              path: ref.path
            })
          }
          return {
            operations: [
              {
                kind: 'write',
                path: ref.path,
                content: deleteClaudeMcpEntry(source, ref.entryKey, 'claude:plan')
              }
            ]
          }
        }
        return { operations: [{ kind: 'delete', path: ref.path }] }
      }

      if (change.kind === 'duplicate') {
        if (!change.newName) {
          throw new AppOperationError('invalid-request', 'claude:plan', 'Duplicate needs a new name')
        }
        const newName = change.newName
        const slug = slugifyName(newName, 'claude:plan')
        if (ref.kind === 'instructions') {
          throw new AppOperationError('invalid-request', 'claude:plan', 'Instructions cannot be duplicated')
        }
        if (ref.kind === 'agents' || ref.kind === 'commands') {
          const raw = readTextFile(ref.path)
          if (raw === null) {
            throw new AppOperationError('not-found', 'claude:plan', `Source file could not be read: ${ref.path}`, {
              path: ref.path
            })
          }
          const path = join(dirname(ref.path), `${slug}.md`)
          assertMissing(path, 'claude:plan')
          return {
            operations: [
              {
                kind: 'write',
                path,
                content:
                  ref.kind === 'agents'
                    ? applyFrontmatterEdit(raw, { fields: { name: newName } })
                    : raw
              }
            ]
          }
        }
        if (ref.kind === 'skills') {
          const sourceDir = dirname(ref.path)
          const targetDir = join(dirname(sourceDir), slug)
          assertMissing(targetDir, 'claude:plan')
          const entries = readdirSync(sourceDir, { withFileTypes: true, recursive: true })
          const operations = entries
            .filter((entry) => entry.isFile())
            .map((entry) => {
              const sourcePath = join(entry.parentPath, entry.name)
              const targetPath = join(targetDir, relative(sourceDir, sourcePath))
              const raw = readTextFile(sourcePath)
              if (raw === null) {
                throw new AppOperationError('invalid-request', 'claude:plan', `Skill file is not readable as UTF-8: ${sourcePath}`, {
                  path: sourcePath
                })
              }
              return {
                kind: 'write' as const,
                path: targetPath,
                content:
                  basename(sourcePath) === 'SKILL.md'
                    ? applyFrontmatterEdit(raw, { fields: { name: newName } })
                    : raw
              }
            })
          return { operations }
        }
        if (ref.kind === 'mcp-servers') {
          if (ref.entryKey === undefined) {
            throw new AppOperationError('invalid-request', 'claude:plan', 'MCP duplicate needs an entry key')
          }
          const source = readTextFile(ref.path)
          if (source === null) {
            throw new AppOperationError('not-found', 'claude:plan', `Source file could not be read: ${ref.path}`, {
              path: ref.path
            })
          }
          const current = parseClaudeMcpServer({
            provider: 'claude',
            kind: 'mcp-servers',
            scope: ref.scope,
            projectId: ref.projectId,
            paths: [ref.path],
            entryKey: ref.entryKey
          })
          return {
            operations: [
              {
                kind: 'write',
                path: ref.path,
                content: createClaudeMcpEntry(source, assertEntryKey(newName, 'claude:plan'), current.fields, 'claude:plan')
              }
            ]
          }
        }
      }

      if (change.kind === 'set-enabled') {
        if (ref.kind !== 'agents' && ref.kind !== 'skills' && ref.kind !== 'commands') {
          throw new AppOperationError(
            'invalid-request',
            'claude:plan',
            'Enable/disable is not supported for this resource kind'
          )
        }
        if (change.enabled === undefined) {
          throw new AppOperationError('invalid-request', 'claude:plan', 'Set-enabled needs an enabled value')
        }
        const currentlyEnabled = !ref.path.endsWith('.disabled')
        if (currentlyEnabled === change.enabled) {
          throw new AppOperationError('invalid-request', 'claude:plan', 'Resource is already in the requested state')
        }
        return { operations: [{ kind: 'move', path: ref.path, toPath: disabledTarget(ref.path, change.enabled) }] }
      }

      throw new AppOperationError('invalid-request', 'claude:plan', `Unknown change kind: ${change.kind}`)
    }
  }
}
