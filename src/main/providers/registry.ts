import type { ProviderId } from '../../shared/resource'
import { AppOperationError } from '../errors'
import { createClaudeAdapter } from './claude'
import { createCodexAdapter } from './codex'
import type { ProviderAdapter } from './types'

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>()

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  all(): ProviderAdapter[] {
    return [...this.adapters.values()]
  }

  get(id: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      throw new AppOperationError(
        'not-found',
        'providers:get',
        `No adapter registered for provider: ${id}`
      )
    }
    return adapter
  }
}

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register(createCodexAdapter())
  registry.register(createClaudeAdapter())
  return registry
}
