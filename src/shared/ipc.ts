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
  label: z.string(),
  createScopes: z.array(z.enum(['user', 'project'])).optional()
})
export type ResourceCategory = z.infer<typeof resourceCategorySchema>

export const providerCapabilitiesSchema = z.object({
  providerId: providerIdSchema,
  displayName: z.string(),
  categories: z.array(resourceCategorySchema)
})
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>

export const usageWindowSchema = z.object({
  label: z.string(),
  usedPercent: z.number().min(0).max(100),
  windowMinutes: z.number().int().positive(),
  resetsAt: z.string()
})
export type UsageWindow = z.infer<typeof usageWindowSchema>

export const dailyUsageSchema = z.object({
  date: z.string(),
  sessions: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative()
})
export type DailyUsage = z.infer<typeof dailyUsageSchema>

export const recentSessionSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  project: z.string(),
  model: z.string().optional(),
  tokens: z.number().int().nonnegative()
})
export type RecentSession = z.infer<typeof recentSessionSchema>

export const providerUsageSchema = z.object({
  providerId: providerIdSchema,
  status: z.enum(['available', 'partial', 'unavailable']),
  source: z.string(),
  updatedAt: z.string().nullable(),
  limits: z.array(usageWindowSchema),
  totalSessions: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  daily: z.array(dailyUsageSchema),
  recentSessions: z.array(recentSessionSchema),
  message: z.string().optional()
})
export type ProviderUsage = z.infer<typeof providerUsageSchema>

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

export const fileFingerprintSchema = z.object({
  path: z.string(),
  hash: z.string()
})

export const resourceEditPayloadSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('form'),
    fields: z.record(z.string(), z.unknown()),
    body: z.string().optional()
  }),
  z.object({ mode: z.literal('source'), raw: z.string() })
])

export const resourceEditSchema = z.object({
  resourceId: z.string(),
  base: z.array(fileFingerprintSchema),
  edit: resourceEditPayloadSchema
})

export const resourceCreateDraftSchema = z.object({
  provider: providerIdSchema,
  kind: z.string(),
  scope: z.enum(['user', 'project']),
  projectId: z.string().optional(),
  name: z.string(),
  fields: z.record(z.string(), z.unknown()),
  body: z.string().optional(),
  raw: z.string().optional()
})

export const resourceMutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('edit'),
    resourceId: z.string(),
    base: z.array(fileFingerprintSchema),
    edit: resourceEditPayloadSchema
  }),
  z.object({
    action: z.literal('create'),
    draft: resourceCreateDraftSchema
  }),
  z.object({
    action: z.literal('duplicate'),
    resourceId: z.string(),
    newName: z.string()
  }),
  z.object({
    action: z.literal('delete'),
    resourceId: z.string(),
    base: z.array(fileFingerprintSchema)
  }),
  z.object({
    action: z.literal('set-enabled'),
    resourceId: z.string(),
    enabled: z.boolean(),
    base: z.array(fileFingerprintSchema)
  })
])

export const validationResultSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(diagnosticSchema)
})
export type ValidationResultShape = z.infer<typeof validationResultSchema>

export const fileOperationSchema = z.object({
  kind: z.enum(['write', 'move', 'delete', 'mkdir', 'rmdir']),
  path: z.string(),
  content: z.string().optional(),
  toPath: z.string().optional()
})

export const fileDiffSchema = z.object({
  path: z.string(),
  unified: z.string()
})

export const changePreviewSchema = z.object({
  operations: z.array(fileOperationSchema),
  diffs: z.array(fileDiffSchema),
  validation: validationResultSchema,
  conflicts: z.array(z.string())
})

export const backupEntrySchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  resourceName: z.string(),
  provider: providerIdSchema,
  kind: z.string(),
  operation: z.enum(['update', 'restore', 'create', 'delete', 'duplicate', 'enable', 'disable']),
  paths: z.array(z.string()),
  createdAt: z.string()
})
export type BackupEntry = z.infer<typeof backupEntrySchema>
export type BackupOperation = BackupEntry['operation']

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
  fingerprints: z.array(fileFingerprintSchema),
  fields: z.record(z.string(), z.unknown()),
  native: z.object({
    format: z.enum(['markdown', 'json', 'toml', 'yaml', 'directory', 'unknown']),
    raw: z.string().optional(),
    unknownFields: z.record(z.string(), z.unknown()).optional()
  })
})

export const applyResultSchema = z.object({
  document: resourceDocumentSchema.nullable(),
  backupId: z.string()
})
export type ApplyResult = z.infer<typeof applyResultSchema>

export const restoreResultSchema = z.object({
  document: resourceDocumentSchema.nullable(),
  backupId: z.string()
})
export type RestoreResult = z.infer<typeof restoreResultSchema>

export const ipcContract = {
  'providers:detect': {
    request: z.undefined(),
    response: z.array(providerStatusSchema)
  },
  'providers:capabilities': {
    request: z.undefined(),
    response: z.array(providerCapabilitiesSchema)
  },
  'usage:list': {
    request: z.undefined(),
    response: z.array(providerUsageSchema)
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
  },
  'resources:validate': {
    request: resourceMutationSchema,
    response: validationResultSchema
  },
  'resources:preview': {
    request: resourceMutationSchema,
    response: changePreviewSchema
  },
  'resources:apply': {
    request: resourceMutationSchema,
    response: applyResultSchema
  },
  'resources:restore': {
    request: z.object({ backupId: z.string() }),
    response: restoreResultSchema
  },
  'resources:export': {
    request: z.object({ resourceId: z.string() }),
    response: z.object({ savedTo: z.string().nullable() })
  },
  'resources:reveal': {
    request: z.object({ resourceId: z.string() }),
    response: z.undefined()
  },
  'imports:pick': {
    request: z.object({ providerId: providerIdSchema, kind: z.string() }),
    response: z.object({ fileName: z.string(), raw: z.string() }).nullable()
  },
  'backups:list': {
    request: z.object({ resourceId: z.string().optional() }),
    response: z.array(backupEntrySchema)
  }
} as const

export const RESOURCES_CHANGED_CHANNEL = 'resources:changed'

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
