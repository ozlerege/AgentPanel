import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { BackupService, type BackupTarget } from './backups'
import { openDatabase } from './db'

const TARGET: BackupTarget = {
  resourceId: 'r1',
  resourceName: 'code-reviewer',
  provider: 'claude',
  kind: 'agents'
}

let root: string
let service: BackupService

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-control-backups-'))
  service = new BackupService(openDatabase(join(root, 'test.db')), join(root, 'backups'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('BackupService', () => {
  it('records, lists, and round-trips file content', () => {
    const id = service.record(TARGET, 'update', [
      { path: '/tmp/a.md', content: 'original' },
      { path: '/tmp/new.md', content: null }
    ])
    const entries = service.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id,
      resourceId: 'r1',
      resourceName: 'code-reviewer',
      provider: 'claude',
      kind: 'agents',
      operation: 'update',
      paths: ['/tmp/a.md', '/tmp/new.md']
    })
    expect(new Date(entries[0]!.createdAt).getTime()).not.toBeNaN()
    const stored = service.get(id)
    expect(stored.target).toEqual(TARGET)
    expect(stored.operation).toBe('update')
    expect(stored.files).toEqual([
      { path: '/tmp/a.md', content: 'original' },
      { path: '/tmp/new.md', content: null }
    ])
  })

  it('filters list by resourceId, newest first', () => {
    service.record(TARGET, 'update', [{ path: '/a', content: '1' }])
    const second = service.record(TARGET, 'update', [{ path: '/a', content: '2' }])
    service.record({ ...TARGET, resourceId: 'r2' }, 'update', [{ path: '/b', content: 'x' }])
    const forR1 = service.list('r1')
    expect(forR1).toHaveLength(2)
    expect(forR1[0]?.id).toBe(second)
    expect(service.list()).toHaveLength(3)
  })

  it('prunes to the latest 50 backups per resource', () => {
    const ids: string[] = []
    for (let i = 0; i < 55; i++) {
      ids.push(service.record(TARGET, 'update', [{ path: '/a', content: String(i) }]))
    }
    const entries = service.list('r1')
    expect(entries).toHaveLength(50)
    const remaining = new Set(entries.map((entry) => entry.id))
    for (const early of ids.slice(0, 5)) expect(remaining.has(early)).toBe(false)
    // pruned content is unreadable
    expect(() => service.get(ids[0]!)).toThrowError(AppOperationError)
  })

  it('throws not-found for unknown ids', () => {
    try {
      service.get('nope')
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('not-found')
    }
  })
})
