import type {
  Project,
  ProviderCapabilities,
  ProviderUsage,
  ProviderStatus,
  ResourceQuery,
  ResourceSummary
} from './ipc'
import type { ResourceDocument } from './resource'

/**
 * The complete surface the preload exposes to the renderer. No generic
 * filesystem access is ever added here (spec section 10.2).
 */
export interface DesktopApi {
  providers: {
    detect(): Promise<ProviderStatus[]>
    capabilities(): Promise<ProviderCapabilities[]>
  }
  usage: {
    list(): Promise<ProviderUsage[]>
  }
  projects: {
    add(): Promise<Project | null>
    list(): Promise<Project[]>
    remove(id: string): Promise<void>
  }
  resources: {
    list(query?: ResourceQuery): Promise<ResourceSummary[]>
    read(id: string): Promise<ResourceDocument>
  }
}
