import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, OctagonAlert, RefreshCw, Search } from 'lucide-react'
import type { Project, ResourceSummary } from '@shared/ipc'
import type { ProviderId } from '@shared/resource'
import { EmptyState } from '../components/EmptyState'
import { ResourceInspector } from '../components/ResourceInspector'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'

interface ResourceListScreenProps {
  providerId: ProviderId
  kind: string
  title: string
  kindLabel: string
}

function worstSeverity(summary: ResourceSummary): 'error' | 'warning' | null {
  if (summary.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'error'
  return summary.diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
    ? 'warning'
    : null
}

export function ResourceListScreen({ providerId, kind, title, kindLabel }: ResourceListScreenProps) {
  const [summaries, setSummaries] = useState<ResourceSummary[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="px-1 text-[13px] font-semibold tracking-tight">{title}</h1>
            <Button variant="ghost" size="sm" aria-label="Refresh" onClick={refresh}>
              <RefreshCw aria-hidden />
            </Button>
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
          <select
            aria-label="Filter by scope"
            className="h-8 rounded-md border border-border bg-transparent px-2 text-[12px] text-foreground"
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value)}
          >
            <option value="all">All scopes</option>
            <option value="user">User</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
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
            return (
              <li key={summary.id}>
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setSelectedId(summary.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                    active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
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
                    <Badge variant="outline">
                      {summary.scope === 'user'
                        ? 'User'
                        : (projectName(summary.projectId) ?? 'Project')}
                    </Badge>
                    {new Date(summary.modifiedAt).toLocaleDateString()}
                  </span>
                </button>
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
          />
        ) : (
          <EmptyState
            title="Nothing selected"
            description="Pick a resource from the list to inspect its fields, diagnostics, and source."
          />
        )}
      </div>
    </div>
  )
}
