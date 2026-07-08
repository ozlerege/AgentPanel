import { createPatch } from 'diff'
import type {
  ChangePreview,
  DiscoveryContext,
  FileDiff,
  FileOperationPlan,
  NativeResource,
  ProviderId,
  ResourceChange,
  ResourceDocument,
  ResourceEdit,
  ValidationResult
} from '../../shared/resource'
import { AppOperationError } from '../errors'
import type { ProviderRegistry } from '../providers/registry'
import type { ProviderAdapter } from '../providers/types'
import { decodeResourceId, type ResourceRef } from '../providers/shared/resource-id'
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

  private async planAndValidate(edit: ResourceEdit): Promise<
    Resolved & { plan: FileOperationPlan | null; validation: ValidationResult }
  > {
    const resolved = await this.resolve(edit.resourceId)
    const change = this.buildChange(edit, resolved.ref, resolved.native)
    let plan: FileOperationPlan
    try {
      plan = await resolved.adapter.plan(change)
    } catch (error) {
      // Bad field shapes / malformed sources become validation errors the UI
      // can show inline; infrastructure errors keep propagating.
      if (
        error instanceof AppOperationError &&
        (error.code === 'invalid-request' || error.code === 'not-found')
      ) {
        return {
          ...resolved,
          plan: null,
          validation: {
            ok: false,
            diagnostics: [{ severity: 'error', message: error.message }]
          }
        }
      }
      throw error
    }
    const validation = await resolved.adapter.validate({
      ...change.draft!,
      raw: plan.operations[0]?.content
    })
    return { ...resolved, plan, validation }
  }

  async validate(edit: ResourceEdit): Promise<ValidationResult> {
    return (await this.planAndValidate(edit)).validation
  }

  async preview(edit: ResourceEdit): Promise<ChangePreview> {
    const { plan, validation } = await this.planAndValidate(edit)
    const operations = plan?.operations ?? []
    const diffs: FileDiff[] = operations
      .filter((operation) => operation.kind === 'write')
      .map((operation) => {
        const before = readTextFile(operation.path) ?? ''
        const after = operation.content ?? ''
        return {
          path: operation.path,
          unified: before === after ? '' : createPatch(operation.path, before, after)
        }
      })
    const conflicts = operations
      .map((operation) => operation.path)
      .filter((path) => {
        const current = readTextFile(path)
        const currentHash = current === null ? '' : sha256Hex(current)
        const baseEntry = edit.base.find((entry) => entry.path === path)
        return baseEntry === undefined || baseEntry.hash !== currentHash
      })
    return { operations, diffs, validation, conflicts }
  }

  async apply(edit: ResourceEdit): Promise<{ document: ResourceDocument; backupId: string }> {
    const { plan, validation, adapter, native, ref } = await this.planAndValidate(edit)
    if (plan === null || !validation.ok) {
      const firstError = validation.diagnostics.find((d) => d.severity === 'error')
      throw new AppOperationError(
        'invalid-request',
        'resources:apply',
        `Validation failed: ${firstError?.message ?? 'unknown error'}`
      )
    }
    const doc = await adapter.parse(native)
    const { backupId } = this.transactions.apply(
      { resourceId: edit.resourceId, resourceName: doc.name, provider: ref.provider, kind: ref.kind },
      plan.operations,
      { base: edit.base, operation: 'update' }
    )
    return { document: await this.read(edit.resourceId), backupId }
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
