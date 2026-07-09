import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { BackupOperation } from '../../shared/ipc'
import type { FileFingerprint, FileOperation } from '../../shared/resource'
import { AppOperationError } from '../errors'
import { sha256Hex } from '../hash'
import { readTextFile } from '../providers/shared/scan'
import type { BackupService, BackupTarget } from './backups'

export interface AllowedWriteLocations {
  /** Directories whose contents may be written (provider roots, projects). */
  roots(): string[]
  /** Exactly-allowed standalone files (e.g. ~/.claude.json). */
  files(): string[]
}

export interface TransactionOptions {
  /** Fingerprints from the read that seeded the edit; omit for restore. */
  base?: FileFingerprint[]
  operation: BackupOperation
}

/** Resolve symlinks through the nearest existing ancestor. */
function realTarget(path: string): string {
  let prefix = resolve(path)
  let suffix = ''
  while (!existsSync(prefix)) {
    suffix = suffix === '' ? basename(prefix) : join(basename(prefix), suffix)
    const parent = dirname(prefix)
    if (parent === prefix) break
    prefix = parent
  }
  try {
    const real = realpathSync(prefix)
    return suffix === '' ? real : join(real, suffix)
  } catch {
    return resolve(path)
  }
}

/**
 * The only write path in the app (spec section 13): allow-list, conflict
 * check, backup, temp-sibling write + atomic rename, post-write verify.
 */
export class TransactionService {
  constructor(
    private readonly allowed: AllowedWriteLocations,
    private readonly backups: BackupService
  ) {}

  apply(
    target: BackupTarget,
    operations: FileOperation[],
    options: TransactionOptions
  ): { backupId: string } {
    const conflictPaths = new Set<string>()
    const snapshotsByPath = new Map<string, string | null>()
    for (const operation of operations) {
      if (operation.kind === 'mkdir') {
        throw new AppOperationError(
          'invalid-request',
          'resources:apply',
          `Unsupported file operation: ${operation.kind}`
        )
      }
      if (operation.kind === 'write' && operation.content === undefined) {
        throw new AppOperationError('invalid-request', 'resources:apply', `Write without content: ${operation.path}`)
      }
      if (operation.kind === 'move' && operation.toPath === undefined) {
        throw new AppOperationError('invalid-request', 'resources:apply', `Move without target: ${operation.path}`)
      }
      this.assertAllowed(operation.path)
      if (operation.kind === 'move') {
        const toPath = operation.toPath
        if (toPath === undefined) {
          throw new AppOperationError('invalid-request', 'resources:apply', `Move without target: ${operation.path}`)
        }
        this.assertAllowed(toPath)
        if (existsSync(toPath)) {
          throw new AppOperationError(
            'conflict',
            'resources:apply',
            `Target already exists: ${toPath}`,
            { path: toPath }
          )
        }
      }
      if (operation.kind !== 'rmdir') {
        conflictPaths.add(operation.path)
        if (!snapshotsByPath.has(operation.path)) {
          snapshotsByPath.set(operation.path, readTextFile(operation.path))
        }
      }
      if (operation.kind === 'move') {
        const toPath = operation.toPath
        if (toPath !== undefined && !snapshotsByPath.has(toPath)) {
          snapshotsByPath.set(toPath, readTextFile(toPath))
        }
      }
    }

    const snapshots = Array.from(snapshotsByPath, ([path, content]) => ({ path, content }))

    if (options.base !== undefined) {
      for (const snapshot of snapshots) {
        if (!conflictPaths.has(snapshot.path)) continue
        const baseEntry = options.base.find((entry) => entry.path === snapshot.path)
        const currentHash = snapshot.content === null ? '' : sha256Hex(snapshot.content)
        if (!baseEntry || baseEntry.hash !== currentHash) {
          throw new AppOperationError(
            'conflict',
            'resources:apply',
            `File changed outside Agent Control: ${snapshot.path}`,
            { path: snapshot.path, recovery: 'Reload the resource and repeat the edit.' }
          )
        }
      }
    }

    const backupId = this.backups.record(target, options.operation, snapshots)
    for (const operation of operations) {
      this.execute(operation, backupId)
    }
    return { backupId }
  }

  private assertAllowed(path: string): void {
    const real = realTarget(path)
    const files = this.allowed.files().map((file) => realTarget(file))
    const roots = this.allowed.roots().map((root) => realTarget(root))
    const allowed =
      files.includes(real) || roots.some((root) => real.startsWith(root + sep))
    if (!allowed) {
      throw new AppOperationError(
        'permission',
        'resources:apply',
        `Path is outside the approved roots: ${path}`,
        { path }
      )
    }
  }

  private execute(operation: FileOperation, backupId: string): void {
    if (operation.kind === 'delete') {
      if (existsSync(operation.path)) unlinkSync(operation.path)
      this.backups.setHashAfter(backupId, operation.path, '')
      return
    }
    if (operation.kind === 'move') {
      const toPath = operation.toPath
      if (toPath === undefined) {
        throw new AppOperationError('invalid-request', 'resources:apply', `Move without target: ${operation.path}`)
      }
      const content = readTextFile(operation.path) ?? ''
      try {
        mkdirSync(dirname(toPath), { recursive: true })
        renameSync(operation.path, toPath)
      } catch (error) {
        throw new AppOperationError(
          'io',
          'resources:apply',
          `Move failed for ${operation.path}: ${error instanceof Error ? error.message : String(error)}`,
          {
            path: operation.path,
            changed: false,
            recovery: `No changes were applied to this file. Backup ${backupId} was created.`
          }
        )
      }
      this.backups.setHashAfter(backupId, operation.path, '')
      this.backups.setHashAfter(backupId, toPath, sha256Hex(content))
      return
    }
    if (operation.kind === 'rmdir') {
      if (!existsSync(operation.path)) return
      try {
        rmdirSync(operation.path)
      } catch (error) {
        throw new AppOperationError(
          'io',
          'resources:apply',
          `Remove directory failed for ${operation.path}: ${error instanceof Error ? error.message : String(error)}`,
          {
            path: operation.path,
            changed: false,
            recovery: `No changes were applied to this directory. Backup ${backupId} was created.`
          }
        )
      }
      return
    }
    const content = operation.content ?? ''
    mkdirSync(dirname(operation.path), { recursive: true })
    const tmp = join(dirname(operation.path), `.agent-control-tmp-${process.pid}-${basename(operation.path)}`)
    try {
      const fd = openSync(tmp, 'w')
      try {
        writeSync(fd, content)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(tmp, operation.path)
    } catch (error) {
      rmSync(tmp, { force: true })
      throw new AppOperationError(
        'io',
        'resources:apply',
        `Write failed for ${operation.path}: ${error instanceof Error ? error.message : String(error)}`,
        {
          path: operation.path,
          changed: false,
          recovery: `No changes were applied to this file. Backup ${backupId} was created.`
        }
      )
    }
    const written = readTextFile(operation.path)
    if (written !== content) {
      throw new AppOperationError(
        'io',
        'resources:apply',
        `Post-write verification failed for ${operation.path}`,
        {
          path: operation.path,
          changed: true,
          recovery: `Restore backup ${backupId} from the Backups screen.`
        }
      )
    }
    this.backups.setHashAfter(backupId, operation.path, sha256Hex(written))
  }
}
