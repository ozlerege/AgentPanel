import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, OctagonAlert, Plus, RefreshCw, RotateCcw, Search } from 'lucide-react'
import type { AppError, Project, ResourceSummary } from '@shared/ipc'
import type { ProviderId, ResourceDocument } from '@shared/resource'
import { EmptyState } from '../components/EmptyState'
import { ResourceInspector } from '../components/ResourceInspector'
import { ResourceActions, type DeletedBackup } from '../components/ResourceActions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'
import { CreateResourceDialog } from '../components/editor/CreateResourceDialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { cn } from '../lib/utils'

interface ResourceListScreenProps {
  providerId: ProviderId
  kind: string
  title: string
  kindLabel: string
  createScopes?: Array<'user' | 'project'>
  resourceChangeVersion?: number
}

function worstSeverity(summary: ResourceSummary): 'error' | 'warning' | null {
  if (summary.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'error'
  return summary.diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
    ? 'warning'
    : null
}

export function ResourceListScreen({
  providerId,
  kind,
  title,
  kindLabel,
  createScopes,
  resourceChangeVersion = 0
}: ResourceListScreenProps) {
  const [summaries, setSummaries] = useState<ResourceSummary[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Owned here, not in ResourceActions: the deleted row/inspector unmounts on
  // refresh, and the undo affordance must outlive it (spec §9).
  const [deletedBackup, setDeletedBackup] = useState<DeletedBackup | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [undoFailure, setUndoFailure] = useState<AppError | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(() => {
    setError(null)
    window.desktopApi.resources
      .list({ providerId, kind })
      .then(setSummaries)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause))
      )
    window.desktopApi.projects
      .list()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [providerId, kind])

  useEffect(refresh, [refresh])

  useEffect(() => {
    if (resourceChangeVersion > 0) refresh()
  }, [resourceChangeVersion, refresh])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (summaries ?? []).filter((summary) => {
      if (scopeFilter === 'user' && summary.scope !== 'user') return false
      if (scopeFilter !== 'all' && scopeFilter !== 'user' && summary.projectId !== scopeFilter) {
        return false
      }
      if (query === '') return true
      return (
        summary.name.toLowerCase().includes(query) ||
        (summary.description ?? '').toLowerCase().includes(query)
      )
    })
  }, [summaries, search, scopeFilter])

  const projectName = (id?: string): string | undefined =>
    projects.find((project) => project.id === id)?.name

  const selected = visible.find((summary) => summary.id === selectedId)
  const canCreate = createScopes !== undefined && createScopes.length > 0

  const handleCreated = (doc: ResourceDocument) => {
    setCreating(false)
    setSelectedId(doc.id)
    refresh()
  }

  const handleActionChanged = (id?: string) => {
    setSelectedId(id ?? null)
    refresh()
  }

  const undoDelete = async () => {
    if (deletedBackup === null) return
    setUndoBusy(true)
    const envelope = await window.desktopApi.resources.restore(deletedBackup.id)
    setUndoBusy(false)
    setDeletedBackup(null)
    if (!envelope.ok) {
      setUndoFailure(envelope.error)
      return
    }
    handleActionChanged(envelope.data.document?.id)
  }

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="px-1 text-[13px] font-semibold tracking-tight">{title}</h1>
            <div className="flex items-center gap-1">
              {canCreate ? (
                <Button variant="ghost" size="sm" aria-label={`Add ${kindLabel}`} onClick={() => setCreating(true)}>
                  <Plus aria-hidden />
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" aria-label="Refresh" onClick={refresh}>
                <RefreshCw aria-hidden />
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              placeholder="Search by name or description"
              aria-label="Search resources"
              className="pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger size="sm" aria-label="Filter by scope" className="text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scopes</SelectItem>
              <SelectItem value="user">User</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error ? (
          <p role="alert" className="p-3 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.map((summary) => {
            const status = worstSeverity(summary)
            const active = selectedId === summary.id
            const scopeLabel =
              summary.scope === 'user' ? 'User' : (projectName(summary.projectId) ?? 'Project')
            return (
              <li key={summary.id}>
                <div
                  className={cn(
                    'group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1 rounded-md transition-colors',
                    active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                  )}
                >
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setSelectedId(summary.id)}
                    className={cn(
                      'flex min-w-0 flex-col gap-0.5 px-2.5 py-2 text-left',
                      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring'
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">{summary.name}</span>
                      {status === 'error' ? (
                        <OctagonAlert
                          aria-label="Has errors"
                          className="size-3.5 shrink-0 text-destructive"
                        />
                      ) : null}
                      {status === 'warning' ? (
                        <AlertTriangle
                          aria-label="Has warnings"
                          className="size-3.5 shrink-0 text-amber-500"
                        />
                      ) : null}
                    </span>
                    {summary.description ? (
                      <span className="line-clamp-2 text-[12px] text-muted-foreground">
                        {summary.description}
                      </span>
                    ) : null}
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="outline">{scopeLabel}</Badge>
                      {summary.enabled === false ? <Badge variant="secondary">Disabled</Badge> : null}
                      {new Date(summary.modifiedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <div className="p-1.5">
                    <ResourceActions
                      resource={summary}
                      scopeLabel={scopeLabel}
                      onChanged={handleActionChanged}
                      onDeleted={setDeletedBackup}
                    />
                  </div>
                </div>
              </li>
            )
          })}
          {summaries !== null && visible.length === 0 ? (
            <li className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              {summaries.length === 0
                ? 'Nothing discovered in this category yet.'
                : 'No resources match the current filters.'}
            </li>
          ) : null}
        </ul>
      </div>

      <div className="min-w-0 flex-1">
        {selected ? (
          <ResourceInspector
            resourceId={selected.id}
            kindLabel={kindLabel}
            projectName={projectName(selected.projectId)}
            resourceChangeVersion={resourceChangeVersion}
            onChanged={handleActionChanged}
            onDeleted={setDeletedBackup}
          />
        ) : (
          <EmptyState
            title="Nothing selected"
            description="Pick a resource from the list to inspect its fields, diagnostics, and source."
          />
        )}
      </div>
      {creating && createScopes !== undefined ? (
        <CreateResourceDialog
          providerId={providerId}
          kind={kind}
          kindLabel={kindLabel}
          createScopes={createScopes}
          projects={projects}
          onCreated={handleCreated}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {deletedBackup ? (
        <Dialog open onOpenChange={(open) => (!open ? setDeletedBackup(null) : undefined)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Deleted {deletedBackup.name}</DialogTitle>
              <DialogDescription>
                A backup was created before files were removed.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={undoDelete} disabled={undoBusy}>
                <RotateCcw aria-hidden /> Undo
              </Button>
              <Button size="sm" onClick={() => setDeletedBackup(null)}>
                OK
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      {undoFailure ? (
        <Dialog open onOpenChange={(open) => (!open ? setUndoFailure(null) : undefined)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Undo failed</DialogTitle>
              <DialogDescription>{undoFailure.message}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setUndoFailure(null)}>
                OK
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
