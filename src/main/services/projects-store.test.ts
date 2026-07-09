import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { openDatabase } from './db'
import { ProjectsStore } from './projects-store'

let projectDir: string
let store: ProjectsStore

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'agent-control-test-'))
  store = new ProjectsStore(openDatabase(':memory:'))
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe('ProjectsStore', () => {
  it('adds a project and derives its name from the directory', () => {
    const project = store.add(projectDir)
    expect(project.path).toBe(projectDir)
    expect(project.name).toBe(projectDir.split('/').at(-1))
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(new Date(project.addedAt).getTime()).not.toBeNaN()
  })

  it('lists added projects', () => {
    const project = store.add(projectDir)
    expect(store.list()).toEqual([project])
  })

  it('removes a project by id', () => {
    const project = store.add(projectDir)
    store.remove(project.id)
    expect(store.list()).toEqual([])
  })

  it('notifies listeners when projects are added or removed', () => {
    const events: string[] = []
    const unsubscribe = store.onDidChange(() => events.push('changed'))

    const project = store.add(projectDir)
    store.remove(project.id)
    unsubscribe()
    const extraDir = join(projectDir, 'extra')
    mkdirSync(extraDir)
    store.add(extraDir)

    expect(events).toEqual(['changed', 'changed'])
  })

  it('rejects a duplicate path with a conflict error', () => {
    store.add(projectDir)
    expect(() => store.add(projectDir)).toThrowError(AppOperationError)
    try {
      store.add(projectDir)
    } catch (error) {
      expect((error as AppOperationError).code).toBe('conflict')
    }
  })

  it('rejects a path that is not an existing directory', () => {
    try {
      store.add(join(projectDir, 'does-not-exist'))
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('not-found')
    }
  })

  it('rejects relative paths', () => {
    try {
      store.add('some/relative/path')
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('invalid-request')
    }
  })

  it('persists across database reopen', () => {
    const dbPath = join(projectDir, 'meta.db')
    const first = new ProjectsStore(openDatabase(dbPath))
    const project = first.add(projectDir)
    const second = new ProjectsStore(openDatabase(dbPath))
    expect(second.list()).toEqual([project])
  })
})
