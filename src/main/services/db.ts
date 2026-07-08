import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL
  );`,
  `CREATE TABLE backups (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    resource_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    operation TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE backup_files (
    backup_id TEXT NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    content_file TEXT,
    hash_before TEXT NOT NULL,
    hash_after TEXT
  );
  CREATE INDEX backup_files_backup_id ON backup_files(backup_id);
  CREATE INDEX backups_resource_id ON backups(resource_id);`
]

export function openDatabase(location: string): DatabaseSync {
  const db = new DatabaseSync(location)
  db.exec('PRAGMA foreign_keys = ON;')
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec(MIGRATIONS[version])
    db.exec(`PRAGMA user_version = ${version + 1}`)
  }
  return db
}
