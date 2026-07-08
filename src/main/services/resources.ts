import type {
  DiscoveryContext,
  NativeResource,
  ProviderId,
  ResourceDocument
} from '../../shared/resource'
import { AppOperationError } from '../errors'
import type { ProviderRegistry } from '../providers/registry'
import { decodeResourceId } from '../providers/shared/resource-id'
import type { ProjectsStore } from './projects-store'

export interface ResourceQuery {
  providerId?: ProviderId
  kind?: string
  scope?: 'user' | 'project'
  projectId?: string
}

export type ResourceSummary = Omit<ResourceDocument, 'fields' | 'native'>

function matches(native: NativeResource, query: ResourceQuery): boolean {
  if (query.kind !== undefined && native.kind !== query.kind) return false
  if (query.scope !== undefined && native.scope !== query.scope) return false
  if (query.projectId !== undefined && native.projectId !== query.projectId) return false
  return true
}

function toSummary(doc: ResourceDocument): ResourceSummary {
  const { fields: _fields, native: _native, ...summary } = doc
  return summary
}

/**
 * Scan-on-demand resource access. read() only parses resources returned by
 * discovery, so forged ids can never reach paths outside approved roots.
 */
export class ResourceService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly projects: ProjectsStore
  ) {}

  private context(): DiscoveryContext {
    return {
      projects: this.projects.list().map((project) => ({
        id: project.id,
        path: project.path
      }))
    }
  }

  async list(query: ResourceQuery): Promise<ResourceSummary[]> {
    const adapters = this.registry
      .all()
      .filter(
        (adapter) => query.providerId === undefined || adapter.id === query.providerId
      )
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
    return adapter.parse(match)
  }
}
