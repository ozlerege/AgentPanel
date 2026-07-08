import { z } from 'zod'

export const providerIdSchema = z.enum(['codex', 'claude'])

export const providerStatusSchema = z.object({
  id: providerIdSchema,
  displayName: z.string(),
  detected: z.boolean(),
  configRoot: z.string().nullable()
})
export type ProviderStatus = z.infer<typeof providerStatusSchema>

export const resourceCategorySchema = z.object({
  id: z.string(),
  label: z.string()
})
export type ResourceCategory = z.infer<typeof resourceCategorySchema>

export const providerCapabilitiesSchema = z.object({
  providerId: providerIdSchema,
  displayName: z.string(),
  categories: z.array(resourceCategorySchema)
})
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  addedAt: z.string()
})
export type Project = z.infer<typeof projectSchema>

export const appErrorSchema = z.object({
  code: z.enum([
    'invalid-request',
    'not-implemented',
    'conflict',
    'not-found',
    'permission',
    'io',
    'internal'
  ]),
  operation: z.string(),
  message: z.string(),
  path: z.string().optional(),
  changed: z.boolean(),
  recovery: z.string().optional()
})
export type AppError = z.infer<typeof appErrorSchema>

export const resourceScopeSchema = z.enum(['user', 'project', 'directory'])

export const diagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  path: z.string().optional()
})

export const resourceQuerySchema = z.object({
  providerId: providerIdSchema.optional(),
  kind: z.string().optional(),
  scope: z.enum(['user', 'project']).optional(),
  projectId: z.string().optional()
})
export type ResourceQuery = z.infer<typeof resourceQuerySchema>

export const resourceSummarySchema = z.object({
  id: z.string(),
  provider: providerIdSchema,
  kind: z.string(),
  name: z.string(),
  description: z.string().optional(),
  scope: resourceScopeSchema,
  projectId: z.string().optional(),
  enabled: z.union([z.boolean(), z.literal('unsupported')]),
  sourcePaths: z.array(z.string()),
  diagnostics: z.array(diagnosticSchema),
  modifiedAt: z.string()
})
export type ResourceSummary = z.infer<typeof resourceSummarySchema>

export const resourceDocumentSchema = resourceSummarySchema.extend({
  fields: z.record(z.string(), z.unknown()),
  native: z.object({
    format: z.enum(['markdown', 'json', 'toml', 'yaml', 'directory', 'unknown']),
    raw: z.string().optional(),
    unknownFields: z.record(z.string(), z.unknown()).optional()
  })
})

export const ipcContract = {
  'providers:detect': {
    request: z.undefined(),
    response: z.array(providerStatusSchema)
  },
  'providers:capabilities': {
    request: z.undefined(),
    response: z.array(providerCapabilitiesSchema)
  },
  'projects:add': {
    request: z.undefined(),
    response: projectSchema.nullable()
  },
  'projects:list': {
    request: z.undefined(),
    response: z.array(projectSchema)
  },
  'projects:remove': {
    request: z.object({ id: z.string() }),
    response: z.undefined()
  },
  'resources:list': {
    request: resourceQuerySchema,
    response: z.array(resourceSummarySchema)
  },
  'resources:read': {
    request: z.object({ id: z.string() }),
    response: resourceDocumentSchema
  }
} as const

export type IpcChannel = keyof typeof ipcContract
export type IpcRequest<C extends IpcChannel> = z.infer<
  (typeof ipcContract)[C]['request']
>
export type IpcResponse<C extends IpcChannel> = z.infer<
  (typeof ipcContract)[C]['response']
>

export type IpcEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }
