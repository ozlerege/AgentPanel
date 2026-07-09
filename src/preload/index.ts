import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/desktop-api'
import type {
  IpcChannel,
  IpcEnvelope,
  IpcRequest,
  IpcResponse
} from '../shared/ipc'
import { RESOURCES_CHANGED_CHANNEL as resourcesChangedChannel } from '../shared/ipc'

async function invoke<C extends IpcChannel>(
  channel: C,
  payload?: IpcRequest<C>
): Promise<IpcResponse<C>> {
  const envelope = (await ipcRenderer.invoke(channel, payload)) as IpcEnvelope<
    IpcResponse<C>
  >
  if (!envelope.ok) {
    throw new Error(`${envelope.error.operation}: ${envelope.error.message}`)
  }
  return envelope.data
}

async function invokeEnvelope<C extends IpcChannel>(
  channel: C,
  payload?: IpcRequest<C>
): Promise<IpcEnvelope<IpcResponse<C>>> {
  return (await ipcRenderer.invoke(channel, payload)) as IpcEnvelope<IpcResponse<C>>
}

const api: DesktopApi = {
  providers: {
    detect: () => invoke('providers:detect'),
    capabilities: () => invoke('providers:capabilities')
  },
  usage: {
    list: () => invoke('usage:list')
  },
  projects: {
    add: () => invoke('projects:add'),
    list: () => invoke('projects:list'),
    remove: async (id) => {
      await invoke('projects:remove', { id })
    }
  },
  resources: {
    list: (query) => invoke('resources:list', query ?? {}),
    read: (id) => invoke('resources:read', { id }),
    validate: (mutation) => invoke('resources:validate', mutation),
    preview: (mutation) => invokeEnvelope('resources:preview', mutation),
    apply: (mutation) => invokeEnvelope('resources:apply', mutation),
    restore: (backupId) => invokeEnvelope('resources:restore', { backupId }),
    export: (resourceId) => invoke('resources:export', { resourceId }),
    reveal: async (resourceId) => {
      await invoke('resources:reveal', { resourceId })
    }
  },
  imports: {
    pick: (providerId, kind) => invoke('imports:pick', { providerId, kind })
  },
  events: {
    onResourcesChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent) => listener()
      ipcRenderer.on(resourcesChangedChannel, wrapped)
      return () =>
        ipcRenderer.removeListener(resourcesChangedChannel, wrapped)
    }
  },
  backups: {
    list: (resourceId) => invoke('backups:list', { resourceId })
  }
}

contextBridge.exposeInMainWorld('desktopApi', api)
