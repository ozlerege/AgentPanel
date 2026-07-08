import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@shared/ipc'
import { Button } from '../components/ui/button'

export function ProjectsScreen() {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)

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

  const removeProject = async (project: Project): Promise<void> => {
    if (!window.confirm(`Remove project "${project.name}" from Agent Control? Files on disk are not touched.`)) {
      return
    }
    setError(null)
    try {
      await window.desktopApi.projects.remove(project.id)
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registered folders scanned for project-scoped resources.
          </p>
        </div>
        <Button onClick={() => void addProject()}>Add project</Button>
      </div>
      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      <ul className="mt-5 flex max-w-2xl flex-col gap-2">
        {projects.map((project) => (
          <li
            key={project.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{project.name}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{project.path}</div>
            </div>
            <Button variant="destructive" onClick={() => void removeProject(project)}>
              Remove
            </Button>
          </li>
        ))}
        {projects.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No projects registered yet. Add a project folder to manage its resources.
          </li>
        ) : null}
      </ul>
    </div>
  )
}
