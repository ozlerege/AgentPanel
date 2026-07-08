export type ProviderId = 'codex' | 'claude'
export type ResourceScope = 'user' | 'project' | 'directory'

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  path?: string
}

export interface ResourceDocument {
  id: string
  provider: ProviderId
  kind: string
  name: string
  description?: string
  scope: ResourceScope
  projectId?: string
  enabled: boolean | 'unsupported'
  sourcePaths: string[]
  fields: Record<string, unknown>
  native: {
    format: 'markdown' | 'json' | 'toml' | 'yaml' | 'directory' | 'unknown'
    raw?: string
    unknownFields?: Record<string, unknown>
  }
  diagnostics: Diagnostic[]
  modifiedAt: string
}

export interface NativeResource {
  provider: ProviderId
  kind: string
  scope: ResourceScope
  projectId?: string
  paths: string[]
}

export interface ResourceDraft {
  provider: ProviderId
  kind: string
  scope: ResourceScope
  projectId?: string
  fields: Record<string, unknown>
  raw?: string
}

export interface ResourceChange {
  kind: 'create' | 'update' | 'delete'
  resourceId?: string
  draft?: ResourceDraft
}

export interface FileOperation {
  kind: 'write' | 'move' | 'delete' | 'mkdir'
  path: string
  content?: string
  toPath?: string
}

export interface FileOperationPlan {
  operations: FileOperation[]
}

export interface ValidationResult {
  ok: boolean
  diagnostics: Diagnostic[]
}

export interface DiscoveryContext {
  projects: Array<{ id: string; path: string }>
}
