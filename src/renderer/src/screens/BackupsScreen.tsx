import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { BackupEntry } from '@shared/ipc'
import { EmptyState } from '../components/EmptyState'
import { ProviderLogo } from '../components/ProviderLogo'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'

export function BackupsScreen() {
  const [entries, setEntries] = useState<BackupEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BackupEntry | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    setError(null)
    window.desktopApi.backups
      .list()
      .then(setEntries)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(refresh, [refresh])

  const restore = async (entry: BackupEntry) => {
    setBusy(true)
    setNotice(null)
    setError(null)
    const envelope = await window.desktopApi.resources.restore(entry.id)
    setBusy(false)
    setConfirming(null)
    if (!envelope.ok) {
      setError(
        `${envelope.error.message}${envelope.error.recovery ? ` ${envelope.error.recovery}` : ''}`
      )
      return
    }
    setNotice(`Restored ${entry.resourceName}. A pre-restore backup was created.`)
    refresh()
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Backups</h1>
          <p className="text-[12px] text-muted-foreground">
            Agent Control snapshots every file before changing it. Latest 50 per resource are kept.
          </p>
        </div>
        <Button variant="ghost" size="sm" aria-label="Refresh" onClick={refresh}>
          <RefreshCw aria-hidden />
        </Button>
      </header>

      {error ? (
        <p role="alert" className="px-6 py-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="px-6 py-3 text-[13px] text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {entries !== null && entries.length === 0 ? (
        <EmptyState
          title="No backups yet"
          description="Backups appear here the first time you save a change to a resource."
        />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto px-6">
          {(entries ?? []).map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-3">
              <ProviderLogo providerId={entry.provider} className="size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{entry.resourceName}</span>
                  <Badge variant="outline">{entry.kind}</Badge>
                  <Badge variant={entry.operation === 'restore' ? 'secondary' : 'outline'}>
                    {entry.operation}
                  </Badge>
                </div>
                {entry.paths.map((path) => (
                  <code
                    key={path}
                    className="block truncate font-mono text-[11px] text-muted-foreground"
                  >
                    {path}
                  </code>
                ))}
                <span className="text-[11px] text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setConfirming(entry)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}

      {confirming ? (
        <Dialog open onOpenChange={(open) => (!open ? setConfirming(null) : undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Restore {confirming.resourceName}?</DialogTitle>
              <DialogDescription>
                The current content of these files will be overwritten (a pre-restore backup is
                created first):
              </DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-1">
              {confirming.paths.map((path) => (
                <li key={path}>
                  <code className="font-mono text-[11px]">{path}</code>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void restore(confirming)} disabled={busy}>
                {busy ? 'Restoring…' : 'Restore'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
