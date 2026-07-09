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
  applyCodexAgentFormEdit,
  applyCodexMcpFormEdit,
  createCodexMcpEntry,
  deleteCodexMcpEntry,
  validateCodexAgentContent,
  validateCodexMcpContent
} from './codex/edit'
import { setTomlValue } from '../fidelity/toml-edit'
import { applyFrontmatterEdit } from '../fidelity/frontmatter-edit'
import { assertEntryKey, codexAgentTemplate, markdownTemplate, slugifyName } from './shared/create'
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

function assertMissing(path: string, operation: string): void {
  if (existsSync(path)) {
    throw new AppOperationError('conflict', operation, `Target already exists: ${path}`, { path })
  }
}

function codexCreatePath(configRoot: string, draft: ResourceDraft, slug: string): string {
  switch (draft.kind) {
    case 'agents':
      return join(configRoot, 'agents', `${slug}.toml`)
    case 'skills':
      return join(configRoot, 'skills', slug, 'SKILL.md')
    case 'instructions':
      if (draft.scope === 'user') return join(configRoot, 'AGENTS.md')
      if (draft.sourcePath !== undefined) return draft.sourcePath
      throw new AppOperationError(
        'invalid-request',
        'codex:plan',
        'Project instructions create needs a target path'
      )
    case 'mcp-servers':
      return join(configRoot, 'config.toml')
    default:
      throw new AppOperationError('invalid-request', 'codex:plan', `Unknown resource kind: ${draft.kind}`)
  }
}

function codexCreateContent(draft: ResourceDraft): string {
  const name = draft.name ?? ''
  const description =
    typeof draft.fields['description'] === 'string' ? draft.fields['description'] : ''
  if (draft.raw !== undefined) return draft.raw
  switch (draft.kind) {
    case 'agents': {
      const instructions =
        typeof draft.fields['developer_instructions'] === 'string'
          ? draft.fields['developer_instructions']
          : ''
      return codexAgentTemplate(name, description, instructions)
    }
    case 'skills':
      return markdownTemplate('skills', name, description, draft.body ?? '')
    case 'instructions':
      return draft.body ?? ''
    default:
      throw new AppOperationError('invalid-request', 'codex:plan', `Unknown resource kind: ${draft.kind}`)
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
          { id: 'agents', label: 'Agents', createScopes: ['user'] },
          { id: 'skills', label: 'Skills', createScopes: ['user'] },
          { id: 'mcp-servers', label: 'MCP Servers', createScopes: ['user'] },
          { id: 'instructions', label: 'Instructions', createScopes: ['user', 'project'] }
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
      if (change.kind === 'create') {
        if (!change.draft?.name) {
          throw new AppOperationError('invalid-request', 'codex:plan', 'Create needs a draft name')
        }
        if (change.draft.kind === 'mcp-servers') {
          const entryKey = assertEntryKey(change.draft.name, 'codex:plan')
          const path = join(configRoot, 'config.toml')
          const source = readTextFile(path) ?? ''
          const content = createCodexMcpEntry(source, entryKey, change.draft.fields, 'codex:plan')
          return { operations: [{ kind: 'write', path, content }] }
        }
        const slug = slugifyName(change.draft.name, 'codex:plan')
        const path = codexCreatePath(configRoot, change.draft, slug)
        assertMissing(path, 'codex:plan')
        return { operations: [{ kind: 'write', path, content: codexCreateContent(change.draft) }] }
      }

      if (change.kind === 'update') {
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

      if (!change.resourceId) {
        throw new AppOperationError(
          'invalid-request',
          'codex:plan',
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
            throw new AppOperationError('invalid-request', 'codex:plan', 'MCP delete needs an entry key')
          }
          const source = readTextFile(ref.path)
          if (source === null) {
            throw new AppOperationError('not-found', 'codex:plan', `Source file could not be read: ${ref.path}`, {
              path: ref.path
            })
          }
          return {
            operations: [
              { kind: 'write', path: ref.path, content: deleteCodexMcpEntry(source, ref.entryKey, 'codex:plan') }
            ]
          }
        }
        return { operations: [{ kind: 'delete', path: ref.path }] }
      }

      if (change.kind === 'duplicate') {
        if (!change.newName) {
          throw new AppOperationError('invalid-request', 'codex:plan', 'Duplicate needs a new name')
        }
        const newName = change.newName
        const slug = slugifyName(newName, 'codex:plan')
        if (ref.kind === 'instructions') {
          throw new AppOperationError('invalid-request', 'codex:plan', 'Instructions cannot be duplicated')
        }
        if (ref.kind === 'agents') {
          const raw = readTextFile(ref.path)
          if (raw === null) throw new AppOperationError('not-found', 'codex:plan', `Source file could not be read: ${ref.path}`, { path: ref.path })
          const path = join(dirname(ref.path), `${slug}.toml`)
          assertMissing(path, 'codex:plan')
          return { operations: [{ kind: 'write', path, content: setTomlValue(raw, [], 'name', newName) }] }
        }
        if (ref.kind === 'skills') {
          const sourceDir = dirname(ref.path)
          const targetDir = join(dirname(sourceDir), slug)
          assertMissing(targetDir, 'codex:plan')
          const entries = readdirSync(sourceDir, { withFileTypes: true, recursive: true })
          const operations = entries
            .filter((entry) => entry.isFile())
            .map((entry) => {
              const sourcePath = join(entry.parentPath, entry.name)
              const targetPath = join(targetDir, relative(sourceDir, sourcePath))
              const raw = readTextFile(sourcePath)
              if (raw === null) {
                throw new AppOperationError('invalid-request', 'codex:plan', `Skill file is not readable as UTF-8: ${sourcePath}`, {
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
            throw new AppOperationError('invalid-request', 'codex:plan', 'MCP duplicate needs an entry key')
          }
          const source = readTextFile(ref.path)
          if (source === null) throw new AppOperationError('not-found', 'codex:plan', `Source file could not be read: ${ref.path}`, { path: ref.path })
          const table = validateCodexMcpContent(source, ref.entryKey, ref.path)
          if (!table.ok) {
            throw new AppOperationError('invalid-request', 'codex:plan', 'Cannot duplicate invalid MCP entry')
          }
          const current = parseCodexMcpServer({
            provider: 'codex',
            kind: 'mcp-servers',
            scope: ref.scope,
            projectId: ref.projectId,
            paths: [ref.path],
            entryKey: ref.entryKey
          })
          const content = createCodexMcpEntry(source, assertEntryKey(newName, 'codex:plan'), current.fields, 'codex:plan')
          return { operations: [{ kind: 'write', path: ref.path, content }] }
        }
      }

      if (change.kind === 'set-enabled') {
        if (ref.kind !== 'agents' && ref.kind !== 'skills') {
          throw new AppOperationError(
            'invalid-request',
            'codex:plan',
            'Enable/disable is not supported for this resource kind'
          )
        }
        if (change.enabled === undefined) {
          throw new AppOperationError('invalid-request', 'codex:plan', 'Set-enabled needs an enabled value')
        }
        const currentlyEnabled = !ref.path.endsWith('.disabled')
        if (currentlyEnabled === change.enabled) {
          throw new AppOperationError('invalid-request', 'codex:plan', 'Resource is already in the requested state')
        }
        return { operations: [{ kind: 'move', path: ref.path, toPath: disabledTarget(ref.path, change.enabled) }] }
      }

      throw new AppOperationError('invalid-request', 'codex:plan', `Unknown change kind: ${change.kind}`)
    }
  }
}
