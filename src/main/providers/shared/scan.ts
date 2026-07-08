import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Files with the extension directly inside dir, sorted. Missing dir -> []. */
export function listFiles(dir: string, extension: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/** Files with the extension at any depth under dir, sorted. Missing dir -> []. */
export function listFilesRecursive(dir: string, extension: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/** Direct subdirectories of dir, sorted. Missing dir -> []. */
export function listSubdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/** File content, or null when unreadable (missing, permission, directory). */
export function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** ISO mtime, or the epoch when the file cannot be stat'ed. */
export function fileModifiedAt(path: string): string {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}
