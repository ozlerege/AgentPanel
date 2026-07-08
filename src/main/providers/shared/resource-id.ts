import { z } from 'zod'
import { AppOperationError } from '../../errors'

const refSchema = z.object({
  provider: z.enum(['codex', 'claude']),
  kind: z.string(),
  scope: z.enum(['user', 'project', 'directory']),
  projectId: z.string().optional(),
  path: z.string(),
  entryKey: z.string().optional()
})

export type ResourceRef = z.infer<typeof refSchema>

/** Stable id: base64url JSON with a fixed key order (undefined keys drop out). */
export function encodeResourceId(ref: ResourceRef): string {
  const canonical = {
    provider: ref.provider,
    kind: ref.kind,
    scope: ref.scope,
    projectId: ref.projectId,
    path: ref.path,
    entryKey: ref.entryKey
  }
  return Buffer.from(JSON.stringify(canonical), 'utf8').toString('base64url')
}

export function decodeResourceId(id: string): ResourceRef {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'))
  } catch {
    throw malformedResourceIdError()
  }

  const result = refSchema.safeParse(parsed)
  if (!result.success) {
    throw malformedResourceIdError()
  }
  return result.data
}

function malformedResourceIdError(): AppOperationError {
  return new AppOperationError('invalid-request', 'resources:read', 'Malformed resource id')
}
