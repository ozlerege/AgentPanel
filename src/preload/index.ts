import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/desktop-api'
import type {
  IpcChannel,
  IpcEnvelope,
  IpcRequest,
  IpcResponse
} from '../shared/ipc'

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

const api: DesktopApi = {
  providers: {
    detect: () => invoke('providers:detect'),
    capabilities: () => invoke('providers:capabilities')
  },
  projects: {
    add: () => invoke('projects:add'),
    list: () => invoke('projects:list'),
    remove: async (id) => {
      await invoke('projects:remove', { id })
    }
  }
}

contextBridge.exposeInMainWorld('desktopApi', api)
