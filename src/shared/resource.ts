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
  disabled?: boolean
  /** Distinguishes entries inside a shared file (e.g. one MCP server name). */
  entryKey?: string
}

export interface ResourceDraft {
  provider: ProviderId
  kind: string
  scope: ResourceScope
  projectId?: string
  name?: string
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
  kind: 'create' | 'update' | 'delete' | 'duplicate' | 'set-enabled'
  resourceId?: string
  draft?: ResourceDraft
  newName?: string
  enabled?: boolean
}

export interface FileOperation {
  /** rmdir removes an empty directory only. */
  kind: 'write' | 'move' | 'delete' | 'mkdir' | 'rmdir'
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

export interface ResourceCreateDraft {
  provider: ProviderId
  kind: string
  scope: 'user' | 'project'
  projectId?: string
  /** Display name; planners slugify it into a filename / entry key. */
  name: string
  fields: Record<string, unknown>
  body?: string
  /** Full native content (imports); wins over fields/body when present. */
  raw?: string
}

export type ResourceMutation =
  | { action: 'edit'; resourceId: string; base: FileFingerprint[]; edit: ResourceEditPayload }
  | { action: 'create'; draft: ResourceCreateDraft }
  | { action: 'duplicate'; resourceId: string; newName: string }
  | { action: 'delete'; resourceId: string; base: FileFingerprint[] }
  | { action: 'set-enabled'; resourceId: string; enabled: boolean; base: FileFingerprint[] }

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
