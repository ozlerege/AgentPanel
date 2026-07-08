import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL
  );`
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
