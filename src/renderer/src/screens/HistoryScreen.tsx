import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import type { BackupEntry } from '@shared/ipc'
import { EmptyState } from '../components/EmptyState'
import { ProviderLogo } from '../components/ProviderLogo'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'

type BadgeStyle = {
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
  className?: string
}

function operationBadgeStyle(operation: BackupEntry['operation']): BadgeStyle {
  if (operation === 'create' || operation === 'duplicate') {
    return {
      variant: 'outline',
      className: 'border-ok/30 bg-ok/10 text-ok'
    }
  }
  if (operation === 'delete' || operation === 'disable') {
    return { variant: 'destructive' }
  }
  return { variant: 'secondary' }
}

export function HistoryScreen() {
  const [entries, setEntries] = useState<BackupEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BackupEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [resourceFilter, setResourceFilter] = useState('')

  const refresh = useCallback(() => {
    setError(null)
    window.desktopApi.backups
      .list()
      .then(setEntries)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(refresh, [refresh])

  const visibleEntries = useMemo(() => {
    const query = resourceFilter.trim().toLowerCase()
    if (query === '') return entries ?? []
    return (entries ?? []).filter((entry) =>
      entry.resourceName.toLowerCase().includes(query)
    )
  }, [entries, resourceFilter])

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
    setNotice(`Undid ${entry.operation} of ${entry.resourceName}. A pre-restore backup was created.`)
    refresh()
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">History</h1>
            <p className="text-[12px] text-muted-foreground">
              Every application-managed change is listed with its undo snapshot.
            </p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Refresh" onClick={refresh}>
            <RefreshCw aria-hidden />
          </Button>
        </div>
        <div className="relative max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            placeholder="Filter by resource name"
            aria-label="Filter history by resource name"
            className="pl-8"
            value={resourceFilter}
            onChange={(event) => setResourceFilter(event.target.value)}
          />
        </div>
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
          title="No history yet"
          description="History entries appear after Agent Control changes a resource."
        />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto px-6">
          {visibleEntries.map((entry) => {
            const badge = operationBadgeStyle(entry.operation)
            return (
              <li
                key={entry.id}
                className="grid grid-cols-[auto_7rem_minmax(0,1fr)_auto] items-center gap-3 py-3"
              >
                <ProviderLogo providerId={entry.provider} className="size-4 shrink-0" />
                <Badge variant={badge.variant} className={badge.className}>
                  {entry.operation}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{entry.resourceName}</span>
                    <Badge variant="outline">{entry.kind}</Badge>
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
                  Undo
                </Button>
              </li>
            )
          })}
          {entries !== null && entries.length > 0 && visibleEntries.length === 0 ? (
            <li className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              No history entries match that resource name.
            </li>
          ) : null}
        </ul>
      )}

      {confirming ? (
        <Dialog open onOpenChange={(open) => (!open ? setConfirming(null) : undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Undo {confirming.operation} of &quot;{confirming.resourceName}&quot;?
              </DialogTitle>
              <DialogDescription>
                These files may be overwritten or removed. A pre-restore backup is created first:
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
                {busy ? 'Undoing…' : 'Undo'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
