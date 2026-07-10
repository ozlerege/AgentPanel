import { useCallback, useEffect, useState } from 'react'
import { Folder, Plus } from 'lucide-react'
import type { Project } from '@shared/ipc'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'

export function ProjectsScreen() {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<Project | null>(null)

  const refresh = useCallback(() => {
    window.desktopApi.projects
      .list()
      .then(setProjects)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause))
      )
  }, [])

  useEffect(refresh, [refresh])

  const addProject = async (): Promise<void> => {
    setError(null)
    try {
      const added = await window.desktopApi.projects.add()
      if (added) refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const confirmRemoval = async (): Promise<void> => {
    if (!pendingRemoval) return
    setError(null)
    try {
      await window.desktopApi.projects.remove(pendingRemoval.id)
      setPendingRemoval(null)
      refresh()
    } catch (cause) {
      setPendingRemoval(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">Projects</h1>
            <p className="text-[12px] text-muted-foreground">
              Folders whose project-level resources Desmos Agent manages.
            </p>
          </div>
          <Button size="sm" onClick={() => void addProject()}>
            <Plus aria-hidden />
            Add project
          </Button>
        </div>
      </header>

      {error ? (
        <p role="alert" className="px-6 py-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Add a project folder to manage its agents, skills, and MCP servers alongside your global configuration."
        />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto px-6">
          {projects.map((project) => (
            <li
              key={project.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3"
            >
              <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-[13px] font-medium">{project.name}</div>
                <code className="block truncate font-mono text-[11px] text-muted-foreground">
                  {project.path}
                </code>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setPendingRemoval(project)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={pendingRemoval !== null} onOpenChange={(open) => !open && setPendingRemoval(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {pendingRemoval?.name}?</DialogTitle>
            <DialogDescription>
              Desmos Agent stops managing this folder. Nothing on disk is deleted.
            </DialogDescription>
          </DialogHeader>
          {pendingRemoval ? (
            <code className="block truncate rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
              {pendingRemoval.path}
            </code>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" size="sm" onClick={() => void confirmRemoval()}>
              Remove project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
