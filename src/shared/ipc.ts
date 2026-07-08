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
