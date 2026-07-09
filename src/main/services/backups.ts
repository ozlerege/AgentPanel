import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { BackupEntry, BackupOperation } from '../../shared/ipc'
import type { ProviderId } from '../../shared/resource'
import { AppOperationError } from '../errors'
import { sha256Hex } from '../hash'

export interface BackupTarget {
  resourceId: string
  resourceName: string
  provider: ProviderId
  kind: string
}

export interface BackupFileContent {
  path: string
  /** File content at backup time; null when the file did not exist. */
  content: string | null
}

const RETAINED_PER_RESOURCE = 50

/**
 * Snapshot store for files about to be modified. Content lives under
 * <storageDir>/<backupId>/<n>; metadata lives in SQLite (spec section 12).
 */
export class BackupService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly storageDir: string
  ) {}

  record(target: BackupTarget, operation: BackupOperation, files: BackupFileContent[]): string {
    const id = randomUUID()
    const dir = join(this.storageDir, id)
    mkdirSync(dir, { recursive: true })
    this.db
      .prepare(
        `INSERT INTO backups (id, resource_id, resource_name, provider, kind, operation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, target.resourceId, target.resourceName, target.provider, target.kind, operation, new Date().toISOString())
    const insertFile = this.db.prepare(
      `INSERT INTO backup_files (backup_id, path, content_file, hash_before, hash_after)
       VALUES (?, ?, ?, ?, NULL)`
    )
    files.forEach((file, index) => {
      let contentFile: string | null = null
      if (file.content !== null) {
        contentFile = String(index)
        writeFileSync(join(dir, contentFile), file.content, 'utf8')
      }
      insertFile.run(id, file.path, contentFile, file.content === null ? '' : sha256Hex(file.content))
    })
    this.prune(target.resourceId)
    return id
  }

  setHashAfter(backupId: string, path: string, hash: string): void {
    this.db
      .prepare('UPDATE backup_files SET hash_after = ? WHERE backup_id = ? AND path = ?')
      .run(hash, backupId, path)
  }

  list(resourceId?: string): BackupEntry[] {
    const rows =
      resourceId === undefined
        ? this.db.prepare('SELECT * FROM backups ORDER BY rowid DESC').all()
        : this.db.prepare('SELECT * FROM backups WHERE resource_id = ? ORDER BY rowid DESC').all(resourceId)
    const pathsFor = this.db.prepare('SELECT path FROM backup_files WHERE backup_id = ? ORDER BY rowid')
    return rows.map((row) => {
      const record = row as Record<string, unknown>
      const id = String(record['id'])
      return {
        id,
        resourceId: String(record['resource_id']),
        resourceName: String(record['resource_name']),
        provider: record['provider'] as ProviderId,
        kind: String(record['kind']),
        operation: record['operation'] as BackupOperation,
        paths: pathsFor.all(id).map((p) => String((p as Record<string, unknown>)['path'])),
        createdAt: String(record['created_at'])
      }
    })
  }

  get(backupId: string): {
    target: BackupTarget
    operation: BackupOperation
    files: BackupFileContent[]
  } {
    const row = this.db.prepare('SELECT * FROM backups WHERE id = ?').get(backupId) as
      | Record<string, unknown>
      | undefined
    if (!row) {
      throw new AppOperationError('not-found', 'resources:restore', `Backup not found: ${backupId}`)
    }
    const files = this.db
      .prepare('SELECT path, content_file FROM backup_files WHERE backup_id = ? ORDER BY rowid')
      .all(backupId)
      .map((fileRow) => {
        const record = fileRow as Record<string, unknown>
        const contentFile = record['content_file']
        let content: string | null = null
        if (contentFile !== null && contentFile !== undefined) {
          try {
            content = readFileSync(join(this.storageDir, backupId, String(contentFile)), 'utf8')
          } catch {
            throw new AppOperationError(
              'io',
              'resources:restore',
              `Backup content is missing or unreadable: ${backupId}`,
              { path: String(record['path']) }
            )
          }
        }
        return { path: String(record['path']), content }
      })
    return {
      target: {
        resourceId: String(row['resource_id']),
        resourceName: String(row['resource_name']),
        provider: row['provider'] as ProviderId,
        kind: String(row['kind'])
      },
      operation: row['operation'] as BackupOperation,
      files
    }
  }

  private prune(resourceId: string): void {
    const stale = this.db
      .prepare('SELECT id FROM backups WHERE resource_id = ? ORDER BY rowid DESC LIMIT -1 OFFSET ?')
      .all(resourceId, RETAINED_PER_RESOURCE)
    for (const row of stale) {
      const id = String((row as Record<string, unknown>)['id'])
      this.db.prepare('DELETE FROM backups WHERE id = ?').run(id)
      rmSync(join(this.storageDir, id), { recursive: true, force: true })
    }
  }
}
