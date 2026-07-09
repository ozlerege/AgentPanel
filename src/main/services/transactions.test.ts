import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { sha256Hex } from '../hash'
import { BackupService, type BackupTarget } from './backups'
import { openDatabase } from './db'
import { TransactionService } from './transactions'

const TARGET: BackupTarget = {
  resourceId: 'r1',
  resourceName: 'code-reviewer',
  provider: 'claude',
  kind: 'agents'
}

let tmp: string
let root: string
let outside: string
let backups: BackupService
let service: TransactionService

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agent-control-txn-'))
  root = join(tmp, 'allowed')
  outside = join(tmp, 'outside')
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  backups = new BackupService(openDatabase(join(tmp, 'test.db')), join(tmp, 'backups'))
  service = new TransactionService(
    { roots: () => [root], files: () => [join(tmp, 'exact.json')] },
    backups
  )
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('TransactionService', () => {
  it('writes atomically inside an allowed root and records a backup', () => {
    const file = join(root, 'a.md')
    writeFileSync(file, 'old')
    const { backupId } = service.apply(
      TARGET,
      [{ kind: 'write', path: file, content: 'new' }],
      { base: [{ path: file, hash: sha256Hex('old') }], operation: 'update' }
    )
    expect(readFileSync(file, 'utf8')).toBe('new')
    expect(backups.get(backupId).files).toEqual([{ path: file, content: 'old' }])
  })

  it('creates parent directories and accepts missing files with empty-hash base', () => {
    const file = join(root, 'nested', 'deep', 'new.md')
    service.apply(TARGET, [{ kind: 'write', path: file, content: 'created' }], {
      base: [{ path: file, hash: '' }],
      operation: 'update'
    })
    expect(readFileSync(file, 'utf8')).toBe('created')
  })

  it('writes to an exactly-allowed file outside the roots', () => {
    const exact = join(tmp, 'exact.json')
    writeFileSync(exact, '{}')
    service.apply(TARGET, [{ kind: 'write', path: exact, content: '{"a":1}' }], {
      base: [{ path: exact, hash: sha256Hex('{}') }],
      operation: 'update'
    })
    expect(readFileSync(exact, 'utf8')).toBe('{"a":1}')
  })

  it('rejects paths outside the allowed locations', () => {
    try {
      service.apply(TARGET, [{ kind: 'write', path: join(outside, 'x.md'), content: 'x' }], {
        base: [{ path: join(outside, 'x.md'), hash: '' }],
        operation: 'update'
      })
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('permission')
    }
  })

  it('rejects symlink escapes from inside a root', () => {
    symlinkSync(outside, join(root, 'link'))
    const escape = join(root, 'link', 'x.md')
    try {
      service.apply(TARGET, [{ kind: 'write', path: escape, content: 'x' }], {
        base: [{ path: escape, hash: '' }],
        operation: 'update'
      })
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('permission')
    }
  })

  it('rejects stale or missing base fingerprints as conflicts, leaving the file untouched', () => {
    const file = join(root, 'a.md')
    writeFileSync(file, 'edited-elsewhere')
    for (const base of [[{ path: file, hash: sha256Hex('old') }], []]) {
      try {
        service.apply(TARGET, [{ kind: 'write', path: file, content: 'new' }], {
          base,
          operation: 'update'
        })
        expect.unreachable()
      } catch (error) {
        expect((error as AppOperationError).code).toBe('conflict')
      }
    }
    expect(readFileSync(file, 'utf8')).toBe('edited-elsewhere')
    expect(backups.list()).toHaveLength(0) // conflicts abort before the backup
  })

  it('skips conflict checks when base is omitted (restore) and supports delete ops', () => {
    const file = join(root, 'a.md')
    writeFileSync(file, 'whatever')
    service.apply(TARGET, [{ kind: 'delete', path: file }], { operation: 'restore' })
    expect(existsSync(file)).toBe(false)
  })

  it('rejects unsupported operation kinds', () => {
    try {
      service.apply(TARGET, [{ kind: 'mkdir', path: join(root, 'a') }], {
        operation: 'update'
      })
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('invalid-request')
    }
  })

  it('moves files inside allowed roots and snapshots both endpoints for restore', () => {
    const source = join(root, 'a.md')
    const target = join(root, 'b.md')
    writeFileSync(source, 'old')
    const { backupId } = service.apply(
      TARGET,
      [{ kind: 'move', path: source, toPath: target }],
      { base: [{ path: source, hash: sha256Hex('old') }], operation: 'disable' }
    )
    expect(existsSync(source)).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe('old')
    expect(backups.get(backupId).files).toEqual([
      { path: source, content: 'old' },
      { path: target, content: null }
    ])

    const backup = backups.get(backupId)
    service.apply(
      TARGET,
      backup.files.map((file) =>
        file.content === null
          ? ({ kind: 'delete', path: file.path } as const)
          : ({ kind: 'write', path: file.path, content: file.content } as const)
      ),
      { operation: 'restore' }
    )
    expect(readFileSync(source, 'utf8')).toBe('old')
    expect(existsSync(target)).toBe(false)
  })

  it('rejects move targets that already exist', () => {
    const source = join(root, 'a.md')
    const target = join(root, 'b.md')
    writeFileSync(source, 'old')
    writeFileSync(target, 'existing')
    expect(() =>
      service.apply(
        TARGET,
        [{ kind: 'move', path: source, toPath: target }],
        { base: [{ path: source, hash: sha256Hex('old') }], operation: 'update' }
      )
    ).toThrowError(expect.objectContaining({ code: 'conflict' }))
    expect(readFileSync(source, 'utf8')).toBe('old')
    expect(readFileSync(target, 'utf8')).toBe('existing')
  })

  it('allow-lists both move source and target paths', () => {
    const source = join(root, 'a.md')
    writeFileSync(source, 'old')
    expect(() =>
      service.apply(
        TARGET,
        [{ kind: 'move', path: join(outside, 'a.md'), toPath: join(root, 'b.md') }],
        { operation: 'update' }
      )
    ).toThrowError(expect.objectContaining({ code: 'permission' }))
    expect(() =>
      service.apply(
        TARGET,
        [{ kind: 'move', path: source, toPath: join(outside, 'b.md') }],
        { operation: 'update' }
      )
    ).toThrowError(expect.objectContaining({ code: 'permission' }))
  })

  it('rejects stale base fingerprints for moves', () => {
    const source = join(root, 'a.md')
    const target = join(root, 'b.md')
    writeFileSync(source, 'edited-elsewhere')
    expect(() =>
      service.apply(
        TARGET,
        [{ kind: 'move', path: source, toPath: target }],
        { base: [{ path: source, hash: sha256Hex('old') }], operation: 'update' }
      )
    ).toThrowError(expect.objectContaining({ code: 'conflict' }))
    expect(readFileSync(source, 'utf8')).toBe('edited-elsewhere')
    expect(existsSync(target)).toBe(false)
  })

  it('removes empty directories, no-ops missing directories, and errors for non-empty ones', () => {
    const empty = join(root, 'empty')
    mkdirSync(empty)
    service.apply(TARGET, [{ kind: 'rmdir', path: empty }], { operation: 'delete' })
    expect(existsSync(empty)).toBe(false)

    service.apply(TARGET, [{ kind: 'rmdir', path: join(root, 'missing') }], {
      operation: 'delete'
    })

    const nonEmpty = join(root, 'non-empty')
    mkdirSync(nonEmpty)
    writeFileSync(join(nonEmpty, 'file.md'), 'x')
    expect(() =>
      service.apply(TARGET, [{ kind: 'rmdir', path: nonEmpty }], { operation: 'delete' })
    ).toThrowError(expect.objectContaining({ code: 'io' }))
    expect(existsSync(nonEmpty)).toBe(true)
  })

  it('dedupes snapshot rows by path and accepts disable operation labels', () => {
    const file = join(root, 'a.md')
    writeFileSync(file, 'old')
    const { backupId } = service.apply(
      TARGET,
      [
        { kind: 'write', path: file, content: 'new' },
        { kind: 'write', path: file, content: 'newer' }
      ],
      { base: [{ path: file, hash: sha256Hex('old') }], operation: 'disable' }
    )
    expect(backups.list()[0]?.operation).toBe('disable')
    expect(backups.get(backupId).files).toEqual([{ path: file, content: 'old' }])
  })
})
