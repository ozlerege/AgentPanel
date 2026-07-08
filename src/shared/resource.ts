export type ProviderId = 'codex' | 'claude'
export type ResourceScope = 'user' | 'project' | 'directory'

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  path?: string
}

export interface FileFingerprint {
  path: string
  /** sha256 hex of the file content; '' when the file does not exist. */
  hash: string
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
  fingerprints: FileFingerprint[]
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
  /** Distinguishes entries inside a shared file (e.g. one MCP server name). */
  entryKey?: string
}

export interface ResourceDraft {
  provider: ProviderId
  kind: string
  scope: ResourceScope
  projectId?: string
  fields: Record<string, unknown>
  raw?: string
  /** Replacement Markdown body for form edits of markdown kinds. */
  body?: string
  /** Entry inside a shared file (MCP server name). */
  entryKey?: string
  /** Primary source path, for validation diagnostics. */
  sourcePath?: string
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

export type ResourceEditPayload =
  | { mode: 'form'; fields: Record<string, unknown>; body?: string }
  | { mode: 'source'; raw: string }

export interface ResourceEdit {
  resourceId: string
  /** Fingerprints from the read that seeded the editor. */
  base: FileFingerprint[]
  edit: ResourceEditPayload
}

export interface FileDiff {
  path: string
  /** Unified diff; empty string when the file is unchanged. */
  unified: string
}

export interface ChangePreview {
  operations: FileOperation[]
  diffs: FileDiff[]
  validation: ValidationResult
  /** Paths whose current content no longer matches the base fingerprints. */
  conflicts: string[]
}

export interface DiscoveryContext {
  projects: Array<{ id: string; path: string }>
}
