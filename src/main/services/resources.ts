import { createPatch } from 'diff'
import { join } from 'node:path'
import type { BackupOperation } from '../../shared/ipc'
import type {
  ChangePreview,
  DiscoveryContext,
  FileDiff,
  FileFingerprint,
  FileOperation,
  FileOperationPlan,
  NativeResource,
  ProviderId,
  ResourceChange,
  ResourceDocument,
  ResourceEdit,
  ResourceMutation,
  ResourceDraft,
  ValidationResult
} from '../../shared/resource'
import { AppOperationError } from '../errors'
import type { ProviderRegistry } from '../providers/registry'
import type { ProviderAdapter } from '../providers/types'
import { decodeResourceId, type ResourceRef } from '../providers/shared/resource-id'
import { assertEntryKey, slugifyName } from '../providers/shared/create'
import { readTextFile } from '../providers/shared/scan'
import { sha256Hex } from '../hash'
import type { BackupService } from './backups'
import type { ProjectsStore } from './projects-store'
import type { TransactionService } from './transactions'

export interface ResourceQuery {
  providerId?: ProviderId
  kind?: string
  scope?: 'user' | 'project'
  projectId?: string
}

export type ResourceSummary = Omit<ResourceDocument, 'fields' | 'native' | 'fingerprints'>

function matches(native: NativeResource, query: ResourceQuery): boolean {
  if (query.kind !== undefined && native.kind !== query.kind) return false
  if (query.scope !== undefined && native.scope !== query.scope) return false
  if (query.projectId !== undefined && native.projectId !== query.projectId) return false
  return true
}

function toSummary(doc: ResourceDocument): ResourceSummary {
  const { fields: _fields, native: _native, fingerprints: _fingerprints, ...summary } = doc
  return summary
}

interface Resolved {
  adapter: ProviderAdapter
  native: NativeResource
  ref: ResourceRef
}

interface PlannedMutation {
  adapter: ProviderAdapter
  change: ResourceChange
  plan: FileOperationPlan | null
  validation: ValidationResult
  base?: FileFingerprint[]
  backupOperation: BackupOperation
  target: {
    resourceId: string
    resourceName: string
    provider: ProviderId
    kind: string
  }
  result: {
    kind: 'read-existing'
    resourceId: string
  } | {
    kind: 'read-planned'
    provider: ProviderId
    resourceKind: string
    scope: 'user' | 'project'
    projectId?: string
    path: string
    entryKey?: string
  } | {
    kind: 'none'
  }
}

/**
 * Scan-on-demand resource access. Reads and writes only touch resources that
 * discovery actually finds, so forged ids can never reach paths outside the
 * approved roots; writes additionally pass the TransactionService allow-list.
 */
export class ResourceService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly projects: ProjectsStore,
    private readonly transactions: TransactionService,
    private readonly backups: BackupService
  ) {}

  private context(): DiscoveryContext {
    return {
      projects: this.projects.list().map((project) => ({
        id: project.id,
        path: project.path
      }))
    }
  }

  private async resolve(id: string): Promise<Resolved> {
    const ref = decodeResourceId(id)
    const adapter = this.registry.get(ref.provider)
    const natives = await adapter.discover(this.context())
    const match = natives.find(
      (native) =>
        native.kind === ref.kind &&
        native.scope === ref.scope &&
        native.projectId === ref.projectId &&
        native.paths[0] === ref.path &&
        native.entryKey === ref.entryKey
    )
    if (!match) {
      throw new AppOperationError(
        'not-found',
        'resources:read',
        `Resource no longer exists: ${ref.path}`,
        { path: ref.path }
      )
    }
    return { adapter, native: match, ref }
  }

  async list(query: ResourceQuery): Promise<ResourceSummary[]> {
    const adapters = this.registry
      .all()
      .filter((adapter) => query.providerId === undefined || adapter.id === query.providerId)
    const summaries: ResourceSummary[] = []
    for (const adapter of adapters) {
      const natives = (await adapter.discover(this.context())).filter((native) =>
        matches(native, query)
      )
      for (const native of natives) {
        summaries.push(toSummary(await adapter.parse(native)))
      }
    }
    return summaries
  }

  async read(id: string): Promise<ResourceDocument> {
    const { adapter, native } = await this.resolve(id)
    return adapter.parse(native)
  }

  private buildChange(edit: ResourceEdit, ref: ResourceRef, native: NativeResource): ResourceChange {
    return {
      kind: 'update',
      resourceId: edit.resourceId,
      draft: {
        provider: ref.provider,
        kind: ref.kind,
        scope: ref.scope,
        projectId: ref.projectId,
        entryKey: ref.entryKey,
        sourcePath: native.paths[0],
        fields: edit.edit.mode === 'form' ? edit.edit.fields : {},
        body: edit.edit.mode === 'form' ? edit.edit.body : undefined,
        raw: edit.edit.mode === 'source' ? edit.edit.raw : undefined
      }
    }
  }

  private projectById(projectId: string | undefined, operation: string): { id: string; path: string } {
    if (projectId === undefined) {
      throw new AppOperationError(
        'invalid-request',
        operation,
        'Project-scope create needs a project id'
      )
    }
    const project = this.projects.list().find((candidate) => candidate.id === projectId)
    if (project === undefined) {
      throw new AppOperationError(
        'invalid-request',
        operation,
        `Unknown project id: ${projectId}`
      )
    }
    return { id: project.id, path: project.path }
  }

  private validateCreateScope(adapter: ProviderAdapter, draft: ResourceMutation & { action: 'create' }): void {
    const category = adapter.capabilities().categories.find((candidate) => candidate.id === draft.draft.kind)
    if (category?.createScopes?.includes(draft.draft.scope) !== true) {
      throw new AppOperationError(
        'invalid-request',
        'resources:validate',
        `Create is not supported for ${draft.draft.provider}/${draft.draft.kind} at ${draft.draft.scope} scope`
      )
    }
    if (draft.draft.scope === 'user' && draft.draft.projectId !== undefined) {
      throw new AppOperationError(
        'invalid-request',
        'resources:validate',
        'User-scope create must not include a project id'
      )
    }
  }

  private projectCreatePath(draft: ResourceDraft, operation: string): string {
    const project = this.projectById(draft.projectId, operation)
    const slug = slugifyName(draft.name ?? '', operation)
    if (draft.provider === 'claude') {
      switch (draft.kind) {
        case 'agents':
          return join(project.path, '.claude', 'agents', `${slug}.md`)
        case 'skills':
          return join(project.path, '.claude', 'skills', slug, 'SKILL.md')
        case 'commands':
          return join(project.path, '.claude', 'commands', `${slug}.md`)
        case 'instructions':
          return join(project.path, 'CLAUDE.md')
        case 'mcp-servers':
          assertEntryKey(draft.name ?? '', operation)
          return join(project.path, '.mcp.json')
        default:
          throw new AppOperationError(
            'invalid-request',
            operation,
            `Unknown resource kind: ${draft.kind}`
          )
      }
    }
    if (draft.provider === 'codex' && draft.kind === 'instructions') {
      return join(project.path, 'AGENTS.md')
    }
    throw new AppOperationError(
      'invalid-request',
      operation,
      `Project-scope create is not supported for ${draft.provider}/${draft.kind}`
    )
  }

  private createDraft(draft: ResourceMutation & { action: 'create' }): ResourceDraft {
    const adapter = this.registry.get(draft.draft.provider)
    this.validateCreateScope(adapter, draft)
    const resourceDraft: ResourceDraft = { ...draft.draft }
    if (resourceDraft.scope === 'project') {
      resourceDraft.sourcePath = this.projectCreatePath(resourceDraft, 'resources:validate')
    }
    return resourceDraft
  }

  private async nativeByPlannedPath(
    adapter: ProviderAdapter,
    provider: ProviderId,
    kind: string,
    scope: 'user' | 'project',
    projectId: string | undefined,
    path: string,
    entryKey: string | undefined
  ): Promise<NativeResource> {
    const natives = await adapter.discover(this.context())
    const match = natives.find(
      (native) =>
        native.provider === provider &&
        native.kind === kind &&
        native.scope === scope &&
        native.projectId === projectId &&
        native.paths[0] === path &&
        native.entryKey === entryKey
    )
    if (match === undefined) {
      throw new AppOperationError(
        'not-found',
        'resources:apply',
        `Created resource was not discovered: ${path}`,
        { path }
      )
    }
    return match
  }

  private baseForPlannedWrites(operations: FileOperation[]): FileFingerprint[] {
    return operations
      .filter((operation) => operation.kind === 'write')
      .map((operation) => {
        const current = readTextFile(operation.path)
        return { path: operation.path, hash: current === null ? '' : sha256Hex(current) }
      })
  }

  private validationDraft(change: ResourceChange, operations: FileOperation[]): ResourceDraft | null {
    const operation = this.primaryWriteOperation(change, operations)
    if (operation === undefined) return null
    if (change.kind === 'create') {
      if (change.draft === undefined) return null
      return {
        ...change.draft,
        entryKey: change.draft.kind === 'mcp-servers' ? change.draft.name : change.draft.entryKey,
        sourcePath: operation.path,
        raw: operation.content
      }
    }
    if (change.draft !== undefined) {
      return { ...change.draft, sourcePath: operation.path, raw: operation.content }
    }
    if (change.kind === 'duplicate') {
      const ref = change.resourceId === undefined ? undefined : decodeResourceId(change.resourceId)
      if (ref === undefined) return null
      return {
        provider: ref.provider,
        kind: ref.kind,
        scope: ref.scope,
        projectId: ref.projectId,
        name: change.newName,
        entryKey: ref.kind === 'mcp-servers' ? change.newName : ref.entryKey,
        fields: {},
        sourcePath: operation.path,
        raw: operation.content
      }
    }
    return null
  }

  private primaryWriteOperation(
    change: ResourceChange,
    operations: FileOperation[]
  ): FileOperation | undefined {
    const writes = operations.filter((operation) => operation.kind === 'write')
    if (change.kind === 'create' && change.draft?.kind === 'skills') {
      return writes.find((operation) => operation.path.endsWith('/SKILL.md')) ?? writes[0]
    }
    if (change.kind === 'duplicate' && change.resourceId !== undefined) {
      const ref = decodeResourceId(change.resourceId)
      if (ref.kind === 'skills') {
        return writes.find((operation) => operation.path.endsWith('/SKILL.md')) ?? writes[0]
      }
    }
    return writes[0]
  }

  private validationFromPlanningError(error: AppOperationError): ValidationResult | null {
    if (
      error.code === 'invalid-request' ||
      error.code === 'not-found' ||
      error.code === 'conflict'
    ) {
      return {
        ok: false,
        diagnostics: [{ severity: 'error', message: error.message, path: error.toAppError().path }]
      }
    }
    return null
  }

  private async planAndValidateMutation(mutation: ResourceMutation): Promise<PlannedMutation> {
    let adapter: ProviderAdapter
    let change: ResourceChange
    let base: FileFingerprint[] | undefined
    let backupOperation: BackupOperation
    let target: PlannedMutation['target']
    let result: PlannedMutation['result']
    let resolved: Resolved | undefined

    if (mutation.action === 'create') {
      const draft = this.createDraft(mutation)
      adapter = this.registry.get(draft.provider)
      change = { kind: 'create', draft }
      backupOperation = 'create'
      target = {
        resourceId: `${draft.provider}:${draft.kind}:${draft.scope}:${draft.projectId ?? ''}:${draft.name}`,
        resourceName: draft.name ?? '',
        provider: draft.provider,
        kind: draft.kind
      }
      result = { kind: 'none' }
    } else {
      resolved = await this.resolve(mutation.resourceId)
      adapter = resolved.adapter
      if (mutation.action === 'edit') {
        const edit: ResourceEdit = {
          resourceId: mutation.resourceId,
          base: mutation.base,
          edit: mutation.edit
        }
        change = this.buildChange(edit, resolved.ref, resolved.native)
        base = mutation.base
        backupOperation = 'update'
        target = {
          resourceId: mutation.resourceId,
          resourceName: (await adapter.parse(resolved.native)).name,
          provider: resolved.ref.provider,
          kind: resolved.ref.kind
        }
        result = { kind: 'read-existing', resourceId: mutation.resourceId }
      } else if (mutation.action === 'duplicate') {
        change = {
          kind: 'duplicate',
          resourceId: mutation.resourceId,
          newName: mutation.newName
        }
        backupOperation = 'duplicate'
        target = {
          resourceId: `${mutation.resourceId}:duplicate:${mutation.newName}`,
          resourceName: mutation.newName,
          provider: resolved.ref.provider,
          kind: resolved.ref.kind
        }
        result = { kind: 'none' }
      } else if (mutation.action === 'delete') {
        change = { kind: 'delete', resourceId: mutation.resourceId }
        base = mutation.base
        backupOperation = 'delete'
        target = {
          resourceId: mutation.resourceId,
          resourceName: (await adapter.parse(resolved.native)).name,
          provider: resolved.ref.provider,
          kind: resolved.ref.kind
        }
        result = { kind: 'none' }
      } else {
        change = {
          kind: 'set-enabled',
          resourceId: mutation.resourceId,
          enabled: mutation.enabled
        }
        base = mutation.base
        backupOperation = mutation.enabled ? 'enable' : 'disable'
        target = {
          resourceId: mutation.resourceId,
          resourceName: (await adapter.parse(resolved.native)).name,
          provider: resolved.ref.provider,
          kind: resolved.ref.kind
        }
        result = { kind: 'none' }
      }
    }

    let plan: FileOperationPlan
    try {
      plan = await adapter.plan(change)
    } catch (error) {
      if (error instanceof AppOperationError) {
        const validation = this.validationFromPlanningError(error)
        if (validation !== null) {
          return {
            adapter,
            change,
            plan: null,
            validation,
            base,
            backupOperation,
            target,
            result
          }
        }
      }
      throw error
    }

    if (base === undefined && (mutation.action === 'create' || mutation.action === 'duplicate')) {
      base = this.baseForPlannedWrites(plan.operations)
    }

    const validationDraft = this.validationDraft(change, plan.operations)
    const validation =
      validationDraft === null
        ? { ok: true, diagnostics: [] }
        : await adapter.validate(validationDraft)

    const primaryWrite = this.primaryWriteOperation(change, plan.operations)
    if (mutation.action === 'create') {
      const draft = change.draft
      if (draft !== undefined && primaryWrite !== undefined) {
        const entryKey = draft.kind === 'mcp-servers' ? draft.name : undefined
        const resourceId = `${draft.provider}:${draft.kind}:${draft.scope}:${draft.projectId ?? ''}:${primaryWrite.path}:${entryKey ?? ''}`
        target = { ...target, resourceId }
        result = {
          kind: 'read-planned',
          provider: draft.provider,
          resourceKind: draft.kind,
          scope: draft.scope === 'project' ? 'project' : 'user',
          projectId: draft.projectId,
          path: primaryWrite.path,
          entryKey
        }
      }
    }
    if (mutation.action === 'duplicate' && resolved !== undefined && primaryWrite !== undefined) {
      const entryKey =
        resolved.ref.kind === 'mcp-servers' ? assertEntryKey(mutation.newName, 'resources:validate') : undefined
      target = {
        ...target,
        resourceId: `${resolved.ref.provider}:${resolved.ref.kind}:${resolved.ref.scope}:${resolved.ref.projectId ?? ''}:${primaryWrite.path}:${entryKey ?? ''}`
      }
      result = {
        kind: 'read-planned',
        provider: resolved.ref.provider,
        resourceKind: resolved.ref.kind,
        scope: resolved.ref.scope === 'project' ? 'project' : 'user',
        projectId: resolved.ref.projectId,
        path: primaryWrite.path,
        entryKey
      }
    }

    return {
      adapter,
      change,
      plan,
      validation,
      base,
      backupOperation,
      target,
      result
    }
  }

  private conflicts(operations: FileOperation[], base: FileFingerprint[] | undefined): string[] {
    if (base === undefined) return []
    const paths = new Set(
      operations.flatMap((operation) =>
        operation.kind === 'move' && operation.toPath !== undefined
          ? [operation.path]
          : operation.kind === 'rmdir'
            ? []
            : [operation.path]
      )
    )
    return Array.from(paths).filter((path) => {
      const current = readTextFile(path)
      const currentHash = current === null ? '' : sha256Hex(current)
      const baseEntry = base.find((entry) => entry.path === path)
      return baseEntry === undefined || baseEntry.hash !== currentHash
    })
  }

  private expandBaseForOperations(
    operations: FileOperation[],
    base: FileFingerprint[] | undefined
  ): FileFingerprint[] | undefined {
    if (base === undefined) return undefined
    const expanded = [...base]
    for (const operation of operations) {
      if (operation.kind === 'rmdir') continue
      if (expanded.some((entry) => entry.path === operation.path)) continue
      const current = readTextFile(operation.path)
      expanded.push({ path: operation.path, hash: current === null ? '' : sha256Hex(current) })
    }
    return expanded
  }

  private diffForOperation(operation: FileOperation): FileDiff | null {
    if (operation.kind === 'write') {
      const before = readTextFile(operation.path) ?? ''
      const after = operation.content ?? ''
      return {
        path: operation.path,
        unified: before === after ? '' : createPatch(operation.path, before, after)
      }
    }
    if (operation.kind === 'delete') {
      const before = readTextFile(operation.path) ?? ''
      return {
        path: operation.path,
        unified: before === '' ? '' : createPatch(operation.path, before, '')
      }
    }
    if (operation.kind === 'move' || operation.kind === 'rmdir') {
      return { path: operation.path, unified: '' }
    }
    return null
  }

  private async resultDocument(planned: PlannedMutation): Promise<ResourceDocument | null> {
    if (planned.result.kind === 'none') return null
    if (planned.result.kind === 'read-existing') return this.read(planned.result.resourceId)
    const native = await this.nativeByPlannedPath(
      planned.adapter,
      planned.result.provider,
      planned.result.resourceKind,
      planned.result.scope,
      planned.result.projectId,
      planned.result.path,
      planned.result.entryKey
    )
    return planned.adapter.parse(native)
  }

  async validate(mutation: ResourceMutation): Promise<ValidationResult> {
    return (await this.planAndValidateMutation(mutation)).validation
  }

  async preview(mutation: ResourceMutation): Promise<ChangePreview> {
    const { plan, validation, base } = await this.planAndValidateMutation(mutation)
    const operations = plan?.operations ?? []
    const diffs = operations
      .map((operation) => this.diffForOperation(operation))
      .filter((diff): diff is FileDiff => diff !== null)
    return { operations, diffs, validation, conflicts: this.conflicts(operations, base) }
  }

  async apply(mutation: ResourceMutation): Promise<{ document: ResourceDocument | null; backupId: string }> {
    const planned = await this.planAndValidateMutation(mutation)
    if (planned.plan === null || !planned.validation.ok) {
      const firstError = planned.validation.diagnostics.find((d) => d.severity === 'error')
      throw new AppOperationError(
        'invalid-request',
        'resources:apply',
        `Validation failed: ${firstError?.message ?? 'unknown error'}`
      )
    }
    const { backupId } = this.transactions.apply(
      planned.target,
      planned.plan.operations,
      {
        base: this.expandBaseForOperations(planned.plan.operations, planned.base),
        operation: planned.backupOperation
      }
    )
    return { document: await this.resultDocument(planned), backupId }
  }

  async restore(backupId: string): Promise<{ document: ResourceDocument | null; backupId: string }> {
    const backup = this.backups.get(backupId)
    const operations = backup.files.map((file) =>
      file.content === null
        ? ({ kind: 'delete', path: file.path } as const)
        : ({ kind: 'write', path: file.path, content: file.content } as const)
    )
    // Restore is an explicit overwrite: no conflict check, but the current
    // state is snapshotted first so the restore itself is undoable.
    const { backupId: preRestoreId } = this.transactions.apply(
      backup.target,
      [...operations],
      { operation: 'restore' }
    )
    let document: ResourceDocument | null = null
    try {
      document = await this.read(backup.target.resourceId)
    } catch {
      document = null
    }
    return { document, backupId: preRestoreId }
  }
}
