import { ipcMain } from 'electron'
import {
  ipcContract,
  type IpcChannel,
  type IpcEnvelope,
  type IpcRequest,
  type IpcResponse
} from '../../shared/ipc'
import { AppOperationError } from '../errors'
import { toAppError } from '../errors'
import type { ProviderRegistry } from '../providers/registry'
import type { BackupService } from '../services/backups'
import type { ExchangeService } from '../services/exchange'
import type { ProjectsStore } from '../services/projects-store'
import type { ResourceService } from '../services/resources'
import type { UsageService } from '../services/usage'
import { isTrustedUrl } from './trust'

export interface HandlerDeps {
  backups: BackupService
  projects: ProjectsStore
  registry: ProviderRegistry
  resources: ResourceService
  exchange: ExchangeService
  usage: UsageService
  pickDirectory(): Promise<string | null>
  reveal(path: string): void
}

function handle<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>) => Promise<IpcResponse<C>> | IpcResponse<C>
): void {
  ipcMain.handle(
    channel,
    async (event, payload: unknown): Promise<IpcEnvelope<IpcResponse<C>>> => {
      const senderUrl = event.senderFrame?.url ?? ''
      if (!isTrustedUrl(senderUrl, process.env['ELECTRON_RENDERER_URL'])) {
        return {
          ok: false,
          error: {
            code: 'permission',
            operation: channel,
            message: `Rejected IPC from untrusted sender: ${senderUrl || '(unknown)'}`,
            changed: false
          }
        }
      }
      const parsed = ipcContract[channel].request.safeParse(payload)
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'invalid-request',
            operation: channel,
            message: parsed.error.issues.map((issue) => issue.message).join('; '),
            changed: false
          }
        }
      }
      try {
        const data = await handler(parsed.data as IpcRequest<C>)
        return { ok: true, data }
      } catch (error) {
        return { ok: false, error: toAppError(channel, error) }
      }
    }
  )
}

export function registerIpcHandlers(deps: HandlerDeps): void {
  handle('providers:detect', async () =>
    Promise.all(deps.registry.all().map((adapter) => adapter.detect()))
  )
  handle('providers:capabilities', () =>
    deps.registry.all().map((adapter) => adapter.capabilities())
  )
  handle('usage:list', () => deps.usage.list())
  handle('projects:add', async () => {
    const directory = await deps.pickDirectory()
    return directory === null ? null : deps.projects.add(directory)
  })
  handle('projects:list', () => deps.projects.list())
  handle('projects:remove', (request) => {
    deps.projects.remove(request.id)
    return undefined
  })
  handle('resources:list', (request) => deps.resources.list(request))
  handle('resources:read', (request) => deps.resources.read(request.id))
  handle('resources:validate', (request) => deps.resources.validate(request))
  handle('resources:preview', (request) => deps.resources.preview(request))
  handle('resources:apply', (request) => deps.resources.apply(request))
  handle('resources:restore', (request) => deps.resources.restore(request.backupId))
  handle('resources:export', (request) => deps.exchange.export(request.resourceId))
  handle('resources:reveal', async (request) => {
    const doc = await deps.resources.read(request.resourceId)
    const path = doc.sourcePaths[0]
    if (path === undefined) {
      throw new AppOperationError('not-found', 'resources:reveal', 'Resource has no source path')
    }
    deps.reveal(path)
    return undefined
  })
  handle('imports:pick', (request) => deps.exchange.pickImport(request.providerId, request.kind))
  handle('backups:list', (request) => deps.backups.list(request.resourceId))
}
