import type {
  ApplyResult,
  BackupEntry,
  IpcEnvelope,
  Project,
  ProviderCapabilities,
  ProviderUsage,
  ProviderStatus,
  ResourceQuery,
  ResourceSummary,
  RestoreResult
} from './ipc'
import type { ChangePreview, ResourceDocument, ResourceEdit, ValidationResult } from './resource'

/**
 * The complete surface the preload exposes to the renderer. No generic
 * filesystem access is ever added here (spec section 10.2).
 *
 * preview/apply/restore return the raw IpcEnvelope instead of throwing so the
 * renderer receives the structured AppError (conflict code, recovery hint);
 * contextBridge strips custom properties from thrown errors.
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
    validate(edit: ResourceEdit): Promise<ValidationResult>
    preview(edit: ResourceEdit): Promise<IpcEnvelope<ChangePreview>>
    apply(edit: ResourceEdit): Promise<IpcEnvelope<ApplyResult>>
    restore(backupId: string): Promise<IpcEnvelope<RestoreResult>>
  }
  backups: {
    list(resourceId?: string): Promise<BackupEntry[]>
  }
}
