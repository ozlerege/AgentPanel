import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Project } from '../../shared/ipc'
import { AppOperationError } from '../errors'

interface ProjectRow {
  id: string
  name: string
  path: string
  added_at: string
}

function toProject(row: ProjectRow): Project {
  return { id: row.id, name: row.name, path: row.path, addedAt: row.added_at }
}

export class ProjectsStore {
  private readonly listeners = new Set<() => void>()

  constructor(private readonly db: DatabaseSync) {}

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  add(rawPath: string): Project {
    if (!isAbsolute(rawPath)) {
      throw new AppOperationError(
        'invalid-request',
        'projects:add',
        `Project path must be absolute: ${rawPath}`
      )
    }
    const path = resolve(rawPath)

    let isDirectory = false
    try {
      isDirectory = statSync(path).isDirectory()
    } catch {
      isDirectory = false
    }
    if (!isDirectory) {
      throw new AppOperationError(
        'not-found',
        'projects:add',
        `Not an existing directory: ${path}`,
        { path }
      )
    }

    const existing = this.db
      .prepare('SELECT id FROM projects WHERE path = ?')
      .get(path)
    if (existing) {
      throw new AppOperationError(
        'conflict',
        'projects:add',
        `Project already registered: ${path}`,
        { path, recovery: 'Remove the existing registration first.' }
      )
    }

    const project: Project = {
      id: randomUUID(),
      name: basename(path),
      path,
      addedAt: new Date().toISOString()
    }
    this.db
      .prepare('INSERT INTO projects (id, name, path, added_at) VALUES (?, ?, ?, ?)')
      .run(project.id, project.name, project.path, project.addedAt)
    this.notifyChange()
    return project
  }

  list(): Project[] {
    const rows = this.db
      .prepare('SELECT id, name, path, added_at FROM projects ORDER BY added_at')
      .all() as unknown as ProjectRow[]
    return rows.map(toProject)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    this.notifyChange()
  }

  private notifyChange(): void {
    for (const listener of this.listeners) listener()
  }
}
