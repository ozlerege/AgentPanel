import type {
  Diagnostic,
  NativeResource,
  ProviderId,
  ResourceDocument,
  ResourceScope
} from '../../../shared/resource'
import { encodeResourceId } from './resource-id'
import { fileModifiedAt } from './scan'

/** The provider/scope context a discover function stamps onto its natives. */
export interface ScopeTemplate {
  provider: ProviderId
  scope: ResourceScope
  projectId?: string
}

export interface DocumentParts {
  name: string
  description?: string
  fields: Record<string, unknown>
  native: ResourceDocument['native']
  diagnostics: Diagnostic[]
}

/** Assemble the ResourceDocument boilerplate every scanner shares. */
export function buildDocument(native: NativeResource, parts: DocumentParts): ResourceDocument {
  return {
    id: encodeResourceId({
      provider: native.provider,
      kind: native.kind,
      scope: native.scope,
      projectId: native.projectId,
      path: native.paths[0],
      entryKey: native.entryKey
    }),
    provider: native.provider,
    kind: native.kind,
    scope: native.scope,
    projectId: native.projectId,
    enabled: 'unsupported',
    sourcePaths: native.paths,
    modifiedAt: fileModifiedAt(native.paths[0]),
    ...parts
  }
}

/** The field's non-empty string value, or undefined. */
export function stringField(
  fields: Record<string, unknown>,
  key: string
): string | undefined {
  const value = fields[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** One warning per missing required string field (e.g. name, description). */
export function missingFieldDiagnostics(
  fields: Record<string, unknown>,
  required: string[],
  path: string
): Diagnostic[] {
  return required
    .filter((key) => stringField(fields, key) === undefined)
    .map((key) => ({
      severity: 'warning' as const,
      message: `Missing required field: ${key}`,
      path
    }))
}
