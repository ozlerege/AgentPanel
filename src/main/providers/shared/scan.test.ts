import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fileExists,
  fileSha256,
  fileModifiedAt,
  listFiles,
  listFilesIncludingDisabled,
  listFilesRecursiveIncludingDisabled,
  listFilesRecursive,
  listSubdirectories,
  readTextFile,
} from "./scan";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-control-scan-"));
  mkdirSync(join(root, "sub", "nested"), { recursive: true });
  writeFileSync(join(root, "a.md"), "A");
  writeFileSync(join(root, "off.md.disabled"), "OFF");
  writeFileSync(join(root, "b.txt"), "B");
  writeFileSync(join(root, "sub", "c.md"), "C");
  writeFileSync(join(root, "sub", "off.md.disabled"), "SUB OFF");
  writeFileSync(join(root, "sub", "nested", "d.md"), "D");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("listFiles", () => {
  it("lists matching files directly in the directory, sorted", () => {
    expect(listFiles(root, ".md")).toEqual([join(root, "a.md")]);
  });

  it("returns [] for a missing directory", () => {
    expect(listFiles(join(root, "nope"), ".md")).toEqual([]);
  });
});

describe("listFilesRecursive", () => {
  it("lists matching files at any depth, sorted", () => {
    expect(listFilesRecursive(root, ".md")).toEqual([
      join(root, "a.md"),
      join(root, "sub", "c.md"),
      join(root, "sub", "nested", "d.md"),
    ]);
  });

  it("returns [] for a missing directory", () => {
    expect(listFilesRecursive(join(root, "nope"), ".md")).toEqual([]);
  });
});

describe('listFilesIncludingDisabled', () => {
  it('lists active files plus disabled variants directly in the directory', () => {
    expect(listFilesIncludingDisabled(root, '.md')).toEqual([
      join(root, 'a.md'),
      join(root, 'off.md.disabled')
    ])
  })
})

describe('listFilesRecursiveIncludingDisabled', () => {
  it('lists active files plus disabled variants at any depth', () => {
    expect(listFilesRecursiveIncludingDisabled(root, '.md')).toEqual([
      join(root, 'a.md'),
      join(root, 'off.md.disabled'),
      join(root, 'sub', 'c.md'),
      join(root, 'sub', 'nested', 'd.md'),
      join(root, 'sub', 'off.md.disabled')
    ])
  })
})

describe("listSubdirectories", () => {
  it("lists direct subdirectories only", () => {
    expect(listSubdirectories(root)).toEqual([join(root, "sub")]);
  });

  it("returns [] for a missing directory", () => {
    expect(listSubdirectories(join(root, "nope"))).toEqual([]);
  });
});

describe("readTextFile", () => {
  it("reads file content", () => {
    expect(readTextFile(join(root, "a.md"))).toBe("A");
  });

  it("returns null for a missing file", () => {
    expect(readTextFile(join(root, "nope.md"))).toBeNull();
  });
});

describe("fileExists", () => {
  it("is true for a file, false for a directory or missing path", () => {
    expect(fileExists(join(root, "a.md"))).toBe(true);
    expect(fileExists(join(root, "sub"))).toBe(false);
    expect(fileExists(join(root, "nope"))).toBe(false);
  });
});

describe("fileModifiedAt", () => {
  it("returns a parseable ISO timestamp", () => {
    const iso = fileModifiedAt(join(root, "a.md"));
    expect(new Date(iso).getTime()).not.toBeNaN();
  });

  it("falls back to the epoch for a missing file", () => {
    expect(fileModifiedAt(join(root, "nope"))).toBe(new Date(0).toISOString());
  });
});

describe('fileSha256', () => {
  it('hashes file content and returns the empty string for missing files', () => {
    writeFileSync(join(root, 'abc.txt'), 'abc')
    expect(fileSha256(join(root, 'abc.txt'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    expect(fileSha256(join(root, 'nope.txt'))).toBe('')
  })
})
