import { useCallback, useEffect, useState } from 'react'
import { Folder, Plus } from 'lucide-react'
import type { Project } from '@shared/ipc'
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
    <div className="mx-auto max-w-3xl px-8 py-7">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Folders whose project-level resources Agent Control manages.
          </p>
        </div>
        <Button size="sm" onClick={() => void addProject()}>
          <Plus aria-hidden />
          Add project
        </Button>
      </header>

      {error ? (
        <p role="alert" className="mt-4 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      <ul className="mt-6 flex flex-col gap-2">
        {projects.map((project) => (
          <li
            key={project.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
          >
            <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{project.name}</div>
              <code className="block truncate font-mono text-[11px] text-muted-foreground">
                {project.path}
              </code>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setPendingRemoval(project)}
            >
              Remove
            </Button>
          </li>
        ))}
        {projects.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
            <p className="text-[13px] font-medium">No projects yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Add a project folder to manage its agents, skills, and MCP servers alongside your
              global configuration.
            </p>
          </li>
        ) : null}
      </ul>

      <Dialog open={pendingRemoval !== null} onOpenChange={(open) => !open && setPendingRemoval(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {pendingRemoval?.name}?</DialogTitle>
            <DialogDescription>
              Agent Control stops managing this folder. Nothing on disk is deleted.
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
