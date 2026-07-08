import type { Project, ProviderCapabilities, ProviderStatus } from './ipc'

/**
 * The complete surface the preload exposes to the renderer. No generic
 * filesystem access is ever added here (spec section 10.2).
 */
export interface DesktopApi {
  providers: {
    detect(): Promise<ProviderStatus[]>
    capabilities(): Promise<ProviderCapabilities[]>
  }
  projects: {
    add(): Promise<Project | null>
    list(): Promise<Project[]>
    remove(id: string): Promise<void>
  }
}
