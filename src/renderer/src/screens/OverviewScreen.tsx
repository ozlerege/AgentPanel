import { useEffect, useState } from 'react'
import type { ProviderStatus } from '@shared/ipc'

export function OverviewScreen() {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.desktopApi.providers
      .detect()
      .then(setProviders)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause))
      )
  }, [])

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Installed providers detected on this machine.
      </p>
      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      <div className="mt-5 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {(providers ?? []).map((provider) => (
          <div key={provider.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">{provider.displayName}</span>
              <span
                className={
                  provider.detected
                    ? 'rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
                    : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                }
              >
                {provider.detected ? 'Detected' : 'Not detected'}
              </span>
            </div>
            <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
              {provider.configRoot ?? 'No configuration directory found'}
            </p>
          </div>
        ))}
        {providers === null && !error ? (
          <p className="text-sm text-muted-foreground">Detecting providers…</p>
        ) : null}
      </div>
    </div>
  )
}
