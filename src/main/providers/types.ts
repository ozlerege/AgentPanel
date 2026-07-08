import type { ProviderCapabilities, ProviderStatus } from '../../shared/ipc'
import type {
  DiscoveryContext,
  FileOperationPlan,
  NativeResource,
  ProviderId,
  ResourceChange,
  ResourceDocument,
  ResourceDraft,
  ValidationResult
} from '../../shared/resource'

export interface ProviderAdapter {
  readonly id: ProviderId
  detect(): Promise<ProviderStatus>
  capabilities(): ProviderCapabilities
  discover(context: DiscoveryContext): Promise<NativeResource[]>
  parse(source: NativeResource): Promise<ResourceDocument>
  validate(draft: ResourceDraft): Promise<ValidationResult>
  plan(change: ResourceChange): Promise<FileOperationPlan>
}
