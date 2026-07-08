# Milestone 3: Safe Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can edit any discovered resource through structured forms or a source editor, with validation, a diff-based change preview, atomic conflict-guarded writes, and automatic backups with restore.

**Architecture:** Fidelity primitives (TOML span-splicing, jsonc surgical edits, YAML-document frontmatter edits) grow set/insert/delete capabilities; per-kind edit modules under `src/main/providers/{shared,codex,claude}/edit.ts` turn form/source edits into full new file content behind the existing `ProviderAdapter.validate/plan` contract; a `TransactionService` enforces allow-listed roots, sha256 conflict checks, and atomic temp+rename writes; a `BackupService` snapshots every touched file into userData with SQLite metadata (retention 50/resource). `ResourceService` orchestrates validate/preview/apply/restore over five new Zod-validated IPC channels; the renderer gains an inspector edit mode (per-kind forms + CodeMirror source tab), a preview dialog with unified diffs, and a Backups screen.

**Tech Stack:** Existing deps (`toml-eslint-parser`, `jsonc-parser`, `yaml`, Zod 4, `node:sqlite`, Vitest 4, React 19, Tailwind 4, shadcn-style components) plus new: `diff` (jsdiff, main process — goes in `dependencies` because electron-vite externalizes main-process deps), `codemirror` + `@codemirror/lang-markdown` + `@codemirror/lang-json` + `@codemirror/state` + `@codemirror/view` and `@types/diff` (renderer/bundled — `devDependencies`). Package manager: **bun**.

**Spec:** `docs/superpowers/specs/2026-07-08-milestone-3-safe-editing-design.md`

## Global Constraints

- Never use `any` in TypeScript (user rule). Use precise types or `unknown` + narrowing.
- Package manager is **bun** (`bun add`, `bun run`, `bunx`). Never npm/yarn/pnpm.
- Verification commands are `bun run typecheck` and `bun run test`. Do NOT run `bun run dev`. Do NOT run `bun run build` except in Task 15 (final verification), where it is explicitly authorized.
- Renderer never receives Node/fs access; no generic `readFile`/`writeFile` across the IPC bridge (spec §10.2).
- Every write path must go through `TransactionService` (allow-list → conflict check → backup → temp+rename → verify). Never write provider files any other way.
- All M3 changes are updates to existing resources. `ResourceChange.kind` values `create`/`delete` are rejected with `not-implemented` ("Arrives in Milestone 4.").
- Validation errors block apply in the MAIN process (not just UI). Warnings never block; the UI requires explicit confirmation.
- Commit after every task with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- There are unrelated uncommitted changes in the worktree (`src/main/index.ts` app-icon lines, `ResourceListScreen.tsx` Select swap, `resources/` icons, `components/ui/select.tsx`). Leave them in place. Stage files explicitly (`git add <paths>`) — never `git add -A` / `git add .`.
- Deviations from the design spec, adopted here deliberately: (1) IPC requests for validate/preview/apply are the `ResourceEdit` object itself, not wrapped in `{ edit }`; (2) content validators live in the per-kind edit modules and adapters dispatch to them; (3) `ResourceDraft` gains optional `body`, `entryKey`, `sourcePath` so validators/planners get the context they need through the existing adapter contract.
- Verified library facts (do not re-litigate): `toml-eslint-parser`'s AST nodes all carry `range: [number, number]`; `getStaticTOMLValue(parseTOML(src))` yields plain values and `parseTOML` throws on syntax errors; `jsonc-parser`'s `modify(src, path, undefined, opts)` REMOVES the property at path; `yaml`'s `Document.set(key, value)` creates the map when contents are empty, and `String(doc)` serializes with comments preserved; `node:sqlite` `DatabaseSync` tables have an implicit `rowid` usable for deterministic ordering; `readdirSync(dir, { withFileTypes: true, recursive: true })` works on the bundled Node.

---

### Task 1: TOML edit primitives — set, insert, delete, serialize

**Files:**

- Modify: `src/main/fidelity/toml-edit.ts` (full rewrite below; keeps existing exports working)
- Modify: `src/main/fidelity/toml-edit.test.ts` (append new describe blocks; existing tests must keep passing)

**Interfaces:**

- Consumes: `parseTOML` from `toml-eslint-parser` (already a dependency).
- Produces (all from `toml-edit.ts`): existing `editTomlValue(source, path, newValueToml)` and `TomlKeyNotFoundError` unchanged; new `TomlValue = string | number | boolean | string[] | Record<string, string>`, `serializeTomlValue(value: TomlValue): string`, `hasTomlKeyValue(source: string, path: Array<string | number>): boolean`, `hasTomlTable(source: string, tablePath: Array<string | number>): boolean`, `setTomlValue(source: string, tablePath: Array<string | number>, key: string, value: TomlValue): string`, `deleteTomlKey(source: string, tablePath: Array<string | number>, key: string): string`, `TomlTableNotFoundError`. Consumed by Task 6 (codex edit planners).

- [ ] **Step 1: Append the failing tests to `src/main/fidelity/toml-edit.test.ts`**

Add these imports to the existing import list from `./toml-edit`: `deleteTomlKey`, `hasTomlKeyValue`, `hasTomlTable`, `serializeTomlValue`, `setTomlValue`, `TomlTableNotFoundError`. Then append:

```ts
const MCP = `# codex config
model = "gpt-5.5"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.github.env]
GITHUB_TOKEN = "abc" # keep

[other]
key = "value"
`

describe('serializeTomlValue', () => {
  it('serializes scalars, arrays, and inline tables with escaping', () => {
    expect(serializeTomlValue('plain')).toBe('"plain"')
    expect(serializeTomlValue('say "hi"\n')).toBe('"say \\"hi\\"\\n"')
    expect(serializeTomlValue(42)).toBe('42')
    expect(serializeTomlValue(true)).toBe('true')
    expect(serializeTomlValue(['a', 'b "c"'])).toBe('["a", "b \\"c\\""]')
    expect(serializeTomlValue({ A: '1', 'weird key': '2' })).toBe(
      '{ A = "1", "weird key" = "2" }'
    )
    expect(serializeTomlValue({})).toBe('{}')
  })
})

describe('setTomlValue', () => {
  it('replaces an existing value inside a table, byte-identical elsewhere', () => {
    expect(setTomlValue(MCP, ['mcp_servers', 'github'], 'command', 'bunx')).toBe(
      MCP.replace('command = "npx"', 'command = "bunx"')
    )
  })

  it('inserts a missing key after the last key-value of the table', () => {
    expect(
      setTomlValue(MCP, ['mcp_servers', 'github'], 'startup_timeout_sec', 30)
    ).toBe(
      MCP.replace(
        'args = ["-y", "@modelcontextprotocol/server-github"]\n',
        'args = ["-y", "@modelcontextprotocol/server-github"]\nstartup_timeout_sec = 30\n'
      )
    )
  })

  it('inserts a top-level key after the last top-level key-value', () => {
    expect(setTomlValue(MCP, [], 'approval_policy', 'never')).toBe(
      MCP.replace('model = "gpt-5.5"\n', 'model = "gpt-5.5"\napproval_policy = "never"\n')
    )
  })

  it('inserts into an empty table right after its header', () => {
    expect(setTomlValue('[empty]\n', ['empty'], 'key', 'v')).toBe('[empty]\nkey = "v"\n')
  })

  it('inserts at the start of a file with no top-level keys', () => {
    expect(setTomlValue('[t]\na = 1\n', [], 'x', 'v')).toBe('x = "v"\n[t]\na = 1\n')
  })

  it('throws TomlTableNotFoundError for a missing table', () => {
    expect(() => setTomlValue(MCP, ['nope'], 'k', 'v')).toThrowError(TomlTableNotFoundError)
  })
})

describe('deleteTomlKey', () => {
  it('removes the whole key line including its trailing comment', () => {
    expect(
      deleteTomlKey(MCP, ['mcp_servers', 'github', 'env'], 'GITHUB_TOKEN')
    ).toBe(MCP.replace('GITHUB_TOKEN = "abc" # keep\n', ''))
  })

  it('throws TomlKeyNotFoundError for a missing key', () => {
    expect(() => deleteTomlKey(MCP, ['mcp_servers', 'github'], 'nope')).toThrowError(
      TomlKeyNotFoundError
    )
  })
})

describe('hasTomlKeyValue / hasTomlTable', () => {
  it('distinguishes key-values from sub-tables', () => {
    expect(hasTomlKeyValue(MCP, ['mcp_servers', 'github', 'command'])).toBe(true)
    expect(hasTomlKeyValue(MCP, ['mcp_servers', 'github', 'env'])).toBe(false)
    expect(hasTomlTable(MCP, ['mcp_servers', 'github', 'env'])).toBe(true)
    expect(hasTomlTable(MCP, ['mcp_servers', 'nope'])).toBe(false)
  })

  it('treats an inline env table as a key-value', () => {
    const inline = '[mcp_servers.x]\nenv = { A = "1" }\n'
    expect(hasTomlKeyValue(inline, ['mcp_servers', 'x', 'env'])).toBe(true)
    expect(hasTomlTable(inline, ['mcp_servers', 'x', 'env'])).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `serializeTomlValue` etc. are not exported.

- [ ] **Step 3: Rewrite `src/main/fidelity/toml-edit.ts`**

```ts
import { parseTOML } from 'toml-eslint-parser'

interface TomlKeySegment {
  type: string
  name?: string
  value?: string | number
}

interface TomlAstNode {
  type: string
  range: [number, number]
  key?: { keys: TomlKeySegment[]; range: [number, number] }
  value?: { range: [number, number] }
  body?: TomlAstNode[]
}

export class TomlKeyNotFoundError extends Error {
  constructor(path: Array<string | number>) {
    super(`TOML key not found: ${path.join('.')}`)
    this.name = 'TomlKeyNotFoundError'
  }
}

export class TomlTableNotFoundError extends Error {
  constructor(path: Array<string | number>) {
    super(`TOML table not found: ${path.join('.')}`)
    this.name = 'TomlTableNotFoundError'
  }
}

export type TomlValue = string | number | boolean | string[] | Record<string, string>

function keySegments(key: { keys: TomlKeySegment[] }): string[] {
  return key.keys.map((segment) =>
    segment.type === 'TOMLBare' ? String(segment.name) : String(segment.value)
  )
}

function topLevel(source: string): TomlAstNode | undefined {
  const program = parseTOML(source) as unknown as { body: TomlAstNode[] }
  return program.body[0]
}

function findKeyValueNode(source: string, path: Array<string | number>): TomlAstNode | null {
  const root = topLevel(source)
  if (!root?.body) return null
  const target = path.map(String).join('\0')
  let found: TomlAstNode | null = null
  const walk = (body: TomlAstNode[], prefix: string[]): void => {
    for (const node of body) {
      if (node.type === 'TOMLKeyValue' && node.key && node.value) {
        const full = [...prefix, ...keySegments(node.key)]
        if (full.join('\0') === target) found = node
      } else if (node.type === 'TOMLTable' && node.key && node.body) {
        walk(node.body, keySegments(node.key))
      }
    }
  }
  walk(root.body, [])
  return found
}

interface TableTarget {
  /** Nodes directly inside the table (for the root, key-values AND tables). */
  body: TomlAstNode[]
  /** Offset just past the table header line; 0 for the root table. */
  headerEnd: number
}

function findTable(source: string, tablePath: Array<string | number>): TableTarget | null {
  const root = topLevel(source)
  if (!root?.body) return null
  if (tablePath.length === 0) return { body: root.body, headerEnd: 0 }
  const target = tablePath.map(String).join('\0')
  for (const node of root.body) {
    if (node.type === 'TOMLTable' && node.key && node.body) {
      if (keySegments(node.key).join('\0') === target) {
        const headerLineEnd = source.indexOf('\n', node.key.range[1])
        return {
          body: node.body,
          headerEnd: headerLineEnd === -1 ? source.length : headerLineEnd + 1
        }
      }
    }
  }
  return null
}

/** Offset at which a new `key = value` line is inserted for the table. */
function insertionOffset(source: string, table: TableTarget): number {
  const keyValues = table.body.filter((node) => node.type === 'TOMLKeyValue')
  const last = keyValues[keyValues.length - 1]
  if (!last) return table.headerEnd
  const lineEnd = source.indexOf('\n', last.range[1])
  return lineEnd === -1 ? source.length : lineEnd + 1
}

function escapeTomlString(value: string): string {
  return (
    '"' +
    value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t') +
    '"'
  )
}

function bareOrQuotedKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : escapeTomlString(key)
}

export function serializeTomlValue(value: TomlValue): string {
  if (typeof value === 'string') return escapeTomlString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(escapeTomlString).join(', ')}]`
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  return `{ ${entries
    .map(([key, entry]) => `${bareOrQuotedKey(key)} = ${escapeTomlString(entry)}`)
    .join(', ')} }`
}

export function hasTomlKeyValue(source: string, path: Array<string | number>): boolean {
  return findKeyValueNode(source, path) !== null
}

export function hasTomlTable(source: string, tablePath: Array<string | number>): boolean {
  return findTable(source, tablePath) !== null
}

/**
 * Replace exactly the byte range of the value at `path` with `newValueToml`
 * (a pre-serialized TOML literal, e.g. '"never"' or '42'). Everything outside
 * the value's range is untouched by construction.
 */
export function editTomlValue(
  source: string,
  path: Array<string | number>,
  newValueToml: string
): string {
  const node = findKeyValueNode(source, path)
  if (!node?.value) throw new TomlKeyNotFoundError(path)
  return source.slice(0, node.value.range[0]) + newValueToml + source.slice(node.value.range[1])
}

/**
 * Set `key` inside the table at `tablePath`: replace the existing value span,
 * or insert a new `key = value` line after the table's last key-value.
 */
export function setTomlValue(
  source: string,
  tablePath: Array<string | number>,
  key: string,
  value: TomlValue
): string {
  const serialized = serializeTomlValue(value)
  const existing = findKeyValueNode(source, [...tablePath, key])
  if (existing?.value) {
    return (
      source.slice(0, existing.value.range[0]) + serialized + source.slice(existing.value.range[1])
    )
  }
  const table = findTable(source, tablePath)
  if (!table) throw new TomlTableNotFoundError(tablePath)
  const offset = insertionOffset(source, table)
  const needsLeadingNewline = offset === source.length && source.length > 0 && !source.endsWith('\n')
  const line = `${bareOrQuotedKey(key)} = ${serialized}\n`
  return source.slice(0, offset) + (needsLeadingNewline ? '\n' : '') + line + source.slice(offset)
}

/** Remove the whole line of `key` in the table at `tablePath` (incl. trailing comment). */
export function deleteTomlKey(
  source: string,
  tablePath: Array<string | number>,
  key: string
): string {
  const node = findKeyValueNode(source, [...tablePath, key])
  if (!node) throw new TomlKeyNotFoundError([...tablePath, key])
  const lineStart = source.lastIndexOf('\n', node.range[0] - 1) + 1
  const lineEnd = source.indexOf('\n', node.range[1])
  return source.slice(0, lineStart) + (lineEnd === -1 ? '' : source.slice(lineEnd + 1))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS (all pre-existing toml-edit tests plus the new blocks).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/fidelity/toml-edit.ts src/main/fidelity/toml-edit.test.ts
git commit -m "feat: toml set/insert/delete primitives with serialization

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Frontmatter edit primitive

**Files:**

- Create: `src/main/fidelity/frontmatter-edit.ts`
- Create: `src/main/fidelity/frontmatter-edit.test.ts`
- Delete: `src/main/fidelity/agent-markdown.ts`
- Delete: `src/main/fidelity/agent-markdown.test.ts`

**Interfaces:**

- Consumes: `parseDocument` from `yaml`.
- Produces: `FrontmatterEdit { fields?: Record<string, string>; body?: string }`, `applyFrontmatterEdit(source: string, edit: FrontmatterEdit): string`. Absorbs the M1 `AgentFormModel` helpers (`agent-markdown.ts` is deleted). Consumed by Task 5 (`applyMarkdownFormEdit`).

- [ ] **Step 1: Confirm nothing outside its own test imports agent-markdown**

Run: `grep -rn "agent-markdown" src/`
Expected: only `src/main/fidelity/agent-markdown.ts` and `src/main/fidelity/agent-markdown.test.ts` appear. If anything else imports it, stop and update this task before deleting.

- [ ] **Step 2: Write the failing tests `src/main/fidelity/frontmatter-edit.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { applyFrontmatterEdit } from './frontmatter-edit'

const AGENT = `---
# reviewer agent
name: code-reviewer
description: Reviews PRs
model: sonnet # keep me
---

You are a reviewer.
`

describe('applyFrontmatterEdit', () => {
  it('sets a single field, preserving comments and unknown fields byte-for-byte', () => {
    const result = applyFrontmatterEdit(AGENT, {
      fields: { description: 'Reviews pull requests' }
    })
    expect(result).toBe(AGENT.replace('description: Reviews PRs', 'description: Reviews pull requests'))
  })

  it('returns the source unchanged for a no-op edit', () => {
    expect(
      applyFrontmatterEdit(AGENT, {
        fields: { name: 'code-reviewer' },
        body: '\nYou are a reviewer.\n'
      })
    ).toBe(AGENT)
  })

  it('replaces the body without touching the frontmatter', () => {
    const result = applyFrontmatterEdit(AGENT, { body: '\nNew body.\n' })
    expect(result).toBe(AGENT.replace('\nYou are a reviewer.\n', '\nNew body.\n'))
    expect(result).toContain('# reviewer agent')
  })

  it('replaces the whole content for a body-only edit without frontmatter', () => {
    expect(applyFrontmatterEdit('Just text\n', { body: 'New\n' })).toBe('New\n')
  })

  it('creates a frontmatter block when fields are set on a plain document', () => {
    expect(applyFrontmatterEdit('Body\n', { fields: { description: 'X' } })).toBe(
      '---\ndescription: X\n---\nBody\n'
    )
  })

  it('handles frontmatter terminated at end-of-file', () => {
    expect(applyFrontmatterEdit('---\nname: a\n---', { fields: { name: 'b' } })).toBe(
      '---\nname: b\n---\n'
    )
  })

  it('throws for unterminated frontmatter', () => {
    expect(() => applyFrontmatterEdit('---\nname: a\n', { fields: { name: 'b' } })).toThrowError(
      'unterminated YAML frontmatter'
    )
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./frontmatter-edit`.

- [ ] **Step 4: Implement `src/main/fidelity/frontmatter-edit.ts`**

```ts
import { parseDocument } from 'yaml'

export interface FrontmatterEdit {
  /** Frontmatter keys to set. Only the provided keys are touched. */
  fields?: Record<string, string>
  /** Replacement for everything after the frontmatter block. */
  body?: string
}

interface SplitDocument {
  /** Raw frontmatter text (without the --- fences), or null when absent. */
  frontmatter: string | null
  body: string
}

function split(source: string): SplitDocument {
  if (!source.startsWith('---\n')) return { frontmatter: null, body: source }
  const close = source.indexOf('\n---\n', 3)
  if (close !== -1) {
    return { frontmatter: source.slice(4, close + 1), body: source.slice(close + 5) }
  }
  if (source.endsWith('\n---')) {
    return { frontmatter: source.slice(4, source.length - 3), body: '' }
  }
  throw new Error('unterminated YAML frontmatter')
}

/**
 * Write form fields and/or a new body back into a Markdown document. Untouched
 * fields, unknown fields, and comments are preserved via the YAML Document API.
 * A no-op edit returns the source unchanged (byte-identical).
 */
export function applyFrontmatterEdit(source: string, edit: FrontmatterEdit): string {
  const parts = split(source)
  const fieldEntries = Object.entries(edit.fields ?? {})
  let frontmatter = parts.frontmatter
  let changed = false

  if (fieldEntries.length > 0) {
    const doc = parseDocument(frontmatter ?? '')
    for (const [key, value] of fieldEntries) {
      if (String(doc.get(key) ?? '') !== value) {
        doc.set(key, value)
        changed = true
      }
    }
    if (changed) frontmatter = String(doc)
  }

  const body = edit.body ?? parts.body
  if (edit.body !== undefined && edit.body !== parts.body) changed = true
  if (!changed) return source

  if (frontmatter === null) return body
  return `---\n${frontmatter}---\n${body}`
}
```

- [ ] **Step 5: Delete the absorbed M1 spike module**

```bash
git rm src/main/fidelity/agent-markdown.ts src/main/fidelity/agent-markdown.test.ts
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS (frontmatter-edit suite green; agent-markdown suite gone).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/fidelity
git commit -m "feat: general frontmatter edit primitive replaces agent-markdown spike

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Shared types, hashing, and document fingerprints

**Files:**

- Modify: `src/shared/resource.ts`
- Create: `src/main/hash.ts`
- Create: `src/main/hash.test.ts`
- Modify: `src/main/providers/shared/scan.ts` (add `fileSha256`)
- Modify: `src/main/providers/shared/scan.test.ts`
- Modify: `src/main/providers/shared/document.ts` (buildDocument emits fingerprints)
- Modify: `src/main/providers/shared/document.test.ts`
- Modify: `src/main/services/resources.ts` (`ResourceSummary` also omits `fingerprints`; `toSummary` strips it)

**Interfaces:**

- Consumes: `createHash` from `node:crypto`.
- Produces: in `src/shared/resource.ts`: `FileFingerprint { path: string; hash: string }` (hash = sha256 hex, `''` for a missing file), `ResourceEditPayload = { mode: 'form'; fields: Record<string, unknown>; body?: string } | { mode: 'source'; raw: string }`, `ResourceEdit { resourceId: string; base: FileFingerprint[]; edit: ResourceEditPayload }`, `FileDiff { path: string; unified: string }`, `ChangePreview { operations: FileOperation[]; diffs: FileDiff[]; validation: ValidationResult; conflicts: string[] }`; `ResourceDocument` gains required `fingerprints: FileFingerprint[]`; `ResourceDraft` gains optional `body?: string`, `entryKey?: string`, `sourcePath?: string`. In `src/main/hash.ts`: `sha256Hex(text: string): string`. In `scan.ts`: `fileSha256(path: string): string` (missing/unreadable → `''`). Consumed by Tasks 4, 9, 10, 11.

- [ ] **Step 1: Write the failing tests**

`src/main/hash.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './hash'

describe('sha256Hex', () => {
  it('matches the well-known sha256 vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})
```

Append to `src/main/providers/shared/scan.test.ts` (add `fileSha256` to the import from `./scan`):

```ts
describe('fileSha256', () => {
  it('hashes file content and returns the empty string for missing files', () => {
    writeFileSync(join(root, 'abc.txt'), 'abc')
    expect(fileSha256(join(root, 'abc.txt'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    expect(fileSha256(join(root, 'nope.txt'))).toBe('')
  })
})
```

Append to the `buildDocument` describe block in `src/main/providers/shared/document.test.ts`:

```ts
  it('fingerprints every source path, empty hash for missing files', () => {
    const doc = buildDocument(native, {
      name: 'x',
      fields: {},
      native: { format: 'markdown' },
      diagnostics: []
    })
    expect(doc.fingerprints).toEqual([{ path: '/tmp/does-not-exist.md', hash: '' }])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `./hash` unresolved, `fileSha256` not exported, `fingerprints` undefined.

- [ ] **Step 3: Implement**

Create `src/main/hash.ts`:

```ts
import { createHash } from 'node:crypto'

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
```

Append to `src/main/providers/shared/scan.ts` (add `import { sha256Hex } from '../../hash'`):

```ts
/** sha256 hex of the file content, or '' when the file cannot be read. */
export function fileSha256(path: string): string {
  const content = readTextFile(path)
  return content === null ? '' : sha256Hex(content)
}
```

In `src/shared/resource.ts`, add after `Diagnostic`:

```ts
export interface FileFingerprint {
  path: string
  /** sha256 hex of the file content; '' when the file does not exist. */
  hash: string
}
```

Add `fingerprints: FileFingerprint[]` to `ResourceDocument` (after `sourcePaths`). Replace `ResourceDraft` with:

```ts
export interface ResourceDraft {
  provider: ProviderId
  kind: string
  scope: ResourceScope
  projectId?: string
  fields: Record<string, unknown>
  raw?: string
  /** Replacement Markdown body for form edits of markdown kinds. */
  body?: string
  /** Entry inside a shared file (MCP server name). */
  entryKey?: string
  /** Primary source path, for validation diagnostics. */
  sourcePath?: string
}
```

Add after `ValidationResult`:

```ts
export type ResourceEditPayload =
  | { mode: 'form'; fields: Record<string, unknown>; body?: string }
  | { mode: 'source'; raw: string }

export interface ResourceEdit {
  resourceId: string
  /** Fingerprints from the read that seeded the editor. */
  base: FileFingerprint[]
  edit: ResourceEditPayload
}

export interface FileDiff {
  path: string
  /** Unified diff; empty string when the file is unchanged. */
  unified: string
}

export interface ChangePreview {
  operations: FileOperation[]
  diffs: FileDiff[]
  validation: ValidationResult
  /** Paths whose current content no longer matches the base fingerprints. */
  conflicts: string[]
}
```

In `src/main/providers/shared/document.ts`: add `fileSha256` to the import from `./scan`, and in `buildDocument`'s returned object add (after `sourcePaths`):

```ts
    fingerprints: native.paths.map((path) => ({ path, hash: fileSha256(path) })),
```

In `src/main/services/resources.ts`: change the summary type and strip:

```ts
export type ResourceSummary = Omit<ResourceDocument, 'fields' | 'native' | 'fingerprints'>

function toSummary(doc: ResourceDocument): ResourceSummary {
  const { fields: _fields, native: _native, fingerprints: _fingerprints, ...summary } = doc
  return summary
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/resource.ts src/main/hash.ts src/main/hash.test.ts src/main/providers/shared src/main/services/resources.ts
git commit -m "feat: file fingerprints and resource edit types

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: IPC contract, DesktopApi, and preload for the write path

**Files:**

- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipc.test.ts` (append)
- Modify: `src/shared/desktop-api.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**

- Consumes: Task 3's shared types (`ResourceEdit`, `ChangePreview`, `FileFingerprint`).
- Produces: Zod schemas `fileFingerprintSchema`, `resourceEditSchema`, `validationResultSchema`, `fileOperationSchema`, `fileDiffSchema`, `changePreviewSchema`, `applyResultSchema`, `restoreResultSchema`, `backupEntrySchema`; inferred types `ApplyResult { document; backupId }`, `RestoreResult { document: ResourceDocument-shape | null; backupId }`, `BackupEntry { id, resourceId, resourceName, provider, kind, operation: 'update' | 'restore', paths, createdAt }`. Channels: `resources:validate` (request `resourceEditSchema` → `validationResultSchema`), `resources:preview` (→ `changePreviewSchema`), `resources:apply` (→ `applyResultSchema`), `resources:restore` (request `{ backupId: string }` → `restoreResultSchema`), `backups:list` (request `{ resourceId?: string }` → `z.array(backupEntrySchema)`). `DesktopApi.resources` gains `validate(edit): Promise<ValidationResult>`, `preview(edit): Promise<IpcEnvelope<ChangePreview>>`, `apply(edit): Promise<IpcEnvelope<ApplyResult>>`, `restore(backupId): Promise<IpcEnvelope<RestoreResult>>`; new `DesktopApi.backups.list(resourceId?): Promise<BackupEntry[]>`. Consumed by Tasks 11 (handlers) and 13–14 (renderer).

Rationale: `preview`/`apply`/`restore` return the raw `IpcEnvelope` instead of throwing, because the renderer needs the structured `AppError` (`code: 'conflict'`, `recovery`, `changed`) to drive the conflict dialog; `contextBridge` strips custom properties from thrown errors, but plain envelope objects cross intact.

- [ ] **Step 1: Append the failing tests to `src/shared/ipc.test.ts`**

```ts
import { ipcContract, backupEntrySchema, changePreviewSchema } from './ipc' // merge into existing imports

describe('resource edit channels', () => {
  const formEdit = {
    resourceId: 'abc',
    base: [{ path: '/f.md', hash: 'aa' }],
    edit: { mode: 'form', fields: { name: 'x' }, body: 'B' }
  }
  const sourceEdit = {
    resourceId: 'abc',
    base: [],
    edit: { mode: 'source', raw: '---\nname: x\n---\n' }
  }

  it('accepts form and source edits on validate/preview/apply', () => {
    for (const channel of ['resources:validate', 'resources:preview', 'resources:apply'] as const) {
      expect(ipcContract[channel].request.parse(formEdit)).toEqual(formEdit)
      expect(ipcContract[channel].request.parse(sourceEdit)).toEqual(sourceEdit)
    }
  })

  it('rejects unknown edit modes and missing fields', () => {
    const bad = { resourceId: 'abc', base: [], edit: { mode: 'patch', raw: 'x' } }
    expect(ipcContract['resources:apply'].request.safeParse(bad).success).toBe(false)
    expect(ipcContract['resources:apply'].request.safeParse({}).success).toBe(false)
  })

  it('validates restore and backups:list requests', () => {
    expect(ipcContract['resources:restore'].request.parse({ backupId: 'b1' })).toEqual({
      backupId: 'b1'
    })
    expect(ipcContract['backups:list'].request.parse({})).toEqual({})
    expect(ipcContract['backups:list'].request.parse({ resourceId: 'r' })).toEqual({
      resourceId: 'r'
    })
  })

  it('parses a change preview and a backup entry', () => {
    const preview = {
      operations: [{ kind: 'write', path: '/f.md', content: 'new' }],
      diffs: [{ path: '/f.md', unified: '@@ -1 +1 @@' }],
      validation: { ok: true, diagnostics: [] },
      conflicts: []
    }
    expect(changePreviewSchema.parse(preview)).toEqual(preview)
    const entry = {
      id: 'b1',
      resourceId: 'r1',
      resourceName: 'code-reviewer',
      provider: 'claude',
      kind: 'agents',
      operation: 'update',
      paths: ['/f.md'],
      createdAt: '2026-07-08T00:00:00.000Z'
    }
    expect(backupEntrySchema.parse(entry)).toEqual(entry)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — new schemas/channels missing.

- [ ] **Step 3: Extend `src/shared/ipc.ts`**

Add after `diagnosticSchema`:

```ts
export const fileFingerprintSchema = z.object({
  path: z.string(),
  hash: z.string()
})

export const resourceEditSchema = z.object({
  resourceId: z.string(),
  base: z.array(fileFingerprintSchema),
  edit: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('form'),
      fields: z.record(z.string(), z.unknown()),
      body: z.string().optional()
    }),
    z.object({ mode: z.literal('source'), raw: z.string() })
  ])
})

export const validationResultSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(diagnosticSchema)
})
export type ValidationResultShape = z.infer<typeof validationResultSchema>

export const fileOperationSchema = z.object({
  kind: z.enum(['write', 'move', 'delete', 'mkdir']),
  path: z.string(),
  content: z.string().optional(),
  toPath: z.string().optional()
})

export const fileDiffSchema = z.object({
  path: z.string(),
  unified: z.string()
})

export const changePreviewSchema = z.object({
  operations: z.array(fileOperationSchema),
  diffs: z.array(fileDiffSchema),
  validation: validationResultSchema,
  conflicts: z.array(z.string())
})

export const backupEntrySchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  resourceName: z.string(),
  provider: providerIdSchema,
  kind: z.string(),
  operation: z.enum(['update', 'restore']),
  paths: z.array(z.string()),
  createdAt: z.string()
})
export type BackupEntry = z.infer<typeof backupEntrySchema>
```

Update `resourceDocumentSchema` to include fingerprints:

```ts
export const resourceDocumentSchema = resourceSummarySchema.extend({
  fingerprints: z.array(fileFingerprintSchema),
  fields: z.record(z.string(), z.unknown()),
  native: z.object({
    format: z.enum(['markdown', 'json', 'toml', 'yaml', 'directory', 'unknown']),
    raw: z.string().optional(),
    unknownFields: z.record(z.string(), z.unknown()).optional()
  })
})
```

Add after it:

```ts
export const applyResultSchema = z.object({
  document: resourceDocumentSchema,
  backupId: z.string()
})
export type ApplyResult = z.infer<typeof applyResultSchema>

export const restoreResultSchema = z.object({
  document: resourceDocumentSchema.nullable(),
  backupId: z.string()
})
export type RestoreResult = z.infer<typeof restoreResultSchema>
```

Add the channels to `ipcContract` (after `resources:read`):

```ts
  'resources:validate': {
    request: resourceEditSchema,
    response: validationResultSchema
  },
  'resources:preview': {
    request: resourceEditSchema,
    response: changePreviewSchema
  },
  'resources:apply': {
    request: resourceEditSchema,
    response: applyResultSchema
  },
  'resources:restore': {
    request: z.object({ backupId: z.string() }),
    response: restoreResultSchema
  },
  'backups:list': {
    request: z.object({ resourceId: z.string().optional() }),
    response: z.array(backupEntrySchema)
  }
```

- [ ] **Step 4: Extend `src/shared/desktop-api.ts`**

Replace the file with:

```ts
import type {
  ApplyResult,
  BackupEntry,
  IpcEnvelope,
  Project,
  ProviderCapabilities,
  ProviderUsage,
  ProviderStatus,
  ResourceQuery,
  ResourceSummary,
  RestoreResult
} from './ipc'
import type { ChangePreview, ResourceDocument, ResourceEdit, ValidationResult } from './resource'

/**
 * The complete surface the preload exposes to the renderer. No generic
 * filesystem access is ever added here (spec section 10.2).
 *
 * preview/apply/restore return the raw IpcEnvelope instead of throwing so the
 * renderer receives the structured AppError (conflict code, recovery hint);
 * contextBridge strips custom properties from thrown errors.
 */
export interface DesktopApi {
  providers: {
    detect(): Promise<ProviderStatus[]>
    capabilities(): Promise<ProviderCapabilities[]>
  }
  usage: {
    list(): Promise<ProviderUsage[]>
  }
  projects: {
    add(): Promise<Project | null>
    list(): Promise<Project[]>
    remove(id: string): Promise<void>
  }
  resources: {
    list(query?: ResourceQuery): Promise<ResourceSummary[]>
    read(id: string): Promise<ResourceDocument>
    validate(edit: ResourceEdit): Promise<ValidationResult>
    preview(edit: ResourceEdit): Promise<IpcEnvelope<ChangePreview>>
    apply(edit: ResourceEdit): Promise<IpcEnvelope<ApplyResult>>
    restore(backupId: string): Promise<IpcEnvelope<RestoreResult>>
  }
  backups: {
    list(resourceId?: string): Promise<BackupEntry[]>
  }
}
```

- [ ] **Step 5: Extend `src/preload/index.ts`**

Add below the existing `invoke` helper:

```ts
async function invokeEnvelope<C extends IpcChannel>(
  channel: C,
  payload?: IpcRequest<C>
): Promise<IpcEnvelope<IpcResponse<C>>> {
  return (await ipcRenderer.invoke(channel, payload)) as IpcEnvelope<IpcResponse<C>>
}
```

Extend the `api` object:

```ts
  resources: {
    list: (query) => invoke('resources:list', query ?? {}),
    read: (id) => invoke('resources:read', { id }),
    validate: (edit) => invoke('resources:validate', edit),
    preview: (edit) => invokeEnvelope('resources:preview', edit),
    apply: (edit) => invokeEnvelope('resources:apply', edit),
    restore: (backupId) => invokeEnvelope('resources:restore', { backupId })
  },
  backups: {
    list: (resourceId) => invoke('backups:list', { resourceId })
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/shared/ipc.test.ts src/shared/desktop-api.ts src/preload/index.ts
git commit -m "feat: write-path IPC channels, desktop api, and preload wiring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Shared edit module — markdown planners, field narrowing, validators

**Files:**

- Create: `src/main/providers/shared/edit.ts`
- Create: `src/main/providers/shared/edit.test.ts`

**Interfaces:**

- Consumes: Task 2's `applyFrontmatterEdit`; M2's `parseFrontmatter`, `missingFieldDiagnostics`; `AppOperationError`.
- Produces: `MarkdownKind = 'agents' | 'skills' | 'commands' | 'instructions'`, `stringFields(fields, keys, operation): Record<string, string>` (throws `invalid-request` on non-string), `applyMarkdownFormEdit(raw, kind, fields, body, operation): string`, `validateMarkdownContent(kind, content, path): ValidationResult`, `McpFormFields { command?: string; args?: string[]; env?: Record<string, string> }`, `mcpFormFields(fields, operation): McpFormFields` (throws `invalid-request` on bad shapes), `sameStringRecord(a: Record<string, unknown>, b: Record<string, string>): boolean`. Consumed by Tasks 6, 7, 8.

- [ ] **Step 1: Write the failing tests `src/main/providers/shared/edit.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { AppOperationError } from '../../errors'
import {
  applyMarkdownFormEdit,
  mcpFormFields,
  sameStringRecord,
  stringFields,
  validateMarkdownContent
} from './edit'

const AGENT = `---
name: code-reviewer
description: Reviews PRs
model: sonnet
---

Body.
`

describe('stringFields', () => {
  it('picks only the requested string keys', () => {
    expect(stringFields({ a: 'x', b: 3, c: 'y' }, ['a', 'missing'], 'op')).toEqual({ a: 'x' })
  })

  it('throws invalid-request for a non-string requested key', () => {
    try {
      stringFields({ a: 3 }, ['a'], 'op')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AppOperationError)
      expect((error as AppOperationError).code).toBe('invalid-request')
    }
  })
})

describe('applyMarkdownFormEdit', () => {
  it('edits agent frontmatter and body', () => {
    const result = applyMarkdownFormEdit(
      AGENT,
      'agents',
      { name: 'code-reviewer', description: 'Reviews pull requests' },
      '\nNew body.\n',
      'op'
    )
    expect(result).toBe(
      AGENT.replace('description: Reviews PRs', 'description: Reviews pull requests').replace(
        '\nBody.\n',
        '\nNew body.\n'
      )
    )
  })

  it('only edits description for commands', () => {
    const result = applyMarkdownFormEdit(
      '---\ndescription: Old\n---\nRun it.\n',
      'commands',
      { description: 'New', name: 'ignored' },
      undefined,
      'op'
    )
    expect(result).toBe('---\ndescription: New\n---\nRun it.\n')
  })

  it('replaces the whole content for instructions', () => {
    expect(applyMarkdownFormEdit('Old\n', 'instructions', {}, 'New\n', 'op')).toBe('New\n')
    expect(applyMarkdownFormEdit('Old\n', 'instructions', {}, undefined, 'op')).toBe('Old\n')
  })
})

describe('validateMarkdownContent', () => {
  it('accepts a healthy agent', () => {
    expect(validateMarkdownContent('agents', AGENT, '/f.md')).toEqual({
      ok: true,
      diagnostics: []
    })
  })

  it('warns on missing description but stays ok', () => {
    const result = validateMarkdownContent('agents', '---\nname: a\n---\nB\n', '/f.md')
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([
      { severity: 'warning', message: 'Missing required field: description', path: '/f.md' }
    ])
  })

  it('rejects broken frontmatter', () => {
    const result = validateMarkdownContent('agents', '---\nname: [broken\n---\nB\n', '/f.md')
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.severity).toBe('error')
  })

  it('warns for an empty command, info for empty instructions', () => {
    const command = validateMarkdownContent('commands', '', '/c.md')
    expect(command.ok).toBe(true)
    expect(command.diagnostics).toEqual([
      { severity: 'warning', message: 'Command file is empty', path: '/c.md' }
    ])
    const instructions = validateMarkdownContent('instructions', '', '/i.md')
    expect(instructions.ok).toBe(true)
    expect(instructions.diagnostics).toEqual([
      { severity: 'info', message: 'File is empty', path: '/i.md' }
    ])
  })
})

describe('mcpFormFields', () => {
  it('narrows command, args, and env', () => {
    expect(
      mcpFormFields({ command: 'npx', args: ['-y'], env: { A: '1' }, extra: 5 }, 'op')
    ).toEqual({ command: 'npx', args: ['-y'], env: { A: '1' } })
    expect(mcpFormFields({}, 'op')).toEqual({})
  })

  it('throws invalid-request on bad shapes', () => {
    expect(() => mcpFormFields({ command: 3 }, 'op')).toThrowError(AppOperationError)
    expect(() => mcpFormFields({ args: ['a', 1] }, 'op')).toThrowError(AppOperationError)
    expect(() => mcpFormFields({ env: { A: 1 } }, 'op')).toThrowError(AppOperationError)
    expect(() => mcpFormFields({ env: ['x'] }, 'op')).toThrowError(AppOperationError)
  })
})

describe('sameStringRecord', () => {
  it('compares records ignoring key order', () => {
    expect(sameStringRecord({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true)
    expect(sameStringRecord({ a: '1' }, { a: '2' })).toBe(false)
    expect(sameStringRecord({ a: '1' }, {})).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./edit`.

- [ ] **Step 3: Implement `src/main/providers/shared/edit.ts`**

```ts
import type { Diagnostic, ValidationResult } from '../../../shared/resource'
import { AppOperationError } from '../../errors'
import { applyFrontmatterEdit } from '../../fidelity/frontmatter-edit'
import { missingFieldDiagnostics } from './document'
import { parseFrontmatter } from './frontmatter'

export type MarkdownKind = 'agents' | 'skills' | 'commands' | 'instructions'

/** Narrow the requested keys to string values; reject non-strings. */
export function stringFields(
  fields: Record<string, unknown>,
  keys: string[],
  operation: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) {
    const value = fields[key]
    if (value === undefined) continue
    if (typeof value !== 'string') {
      throw new AppOperationError('invalid-request', operation, `Field ${key} must be a string`)
    }
    out[key] = value
  }
  return out
}

/** New file content for a form edit of a markdown-based resource. */
export function applyMarkdownFormEdit(
  raw: string,
  kind: MarkdownKind,
  fields: Record<string, unknown>,
  body: string | undefined,
  operation: string
): string {
  if (kind === 'instructions') return body ?? raw
  const editable = kind === 'commands' ? ['description'] : ['name', 'description']
  return applyFrontmatterEdit(raw, { fields: stringFields(fields, editable, operation), body })
}

/** Validate proposed markdown content with the same rules discovery uses. */
export function validateMarkdownContent(
  kind: MarkdownKind,
  content: string,
  path: string
): ValidationResult {
  const parsed = parseFrontmatter(content)
  const diagnostics: Diagnostic[] = parsed.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    path
  }))
  const parseFailed = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  if (!parseFailed) {
    if (kind === 'agents' || kind === 'skills') {
      diagnostics.push(...missingFieldDiagnostics(parsed.fields, ['name', 'description'], path))
    }
    if (kind === 'commands' && content.trim() === '') {
      diagnostics.push({ severity: 'warning', message: 'Command file is empty', path })
    }
    if (kind === 'instructions' && content.trim() === '') {
      diagnostics.push({ severity: 'info', message: 'File is empty', path })
    }
  }
  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    diagnostics
  }
}

export interface McpFormFields {
  command?: string
  args?: string[]
  env?: Record<string, string>
}

/** Narrow an untyped MCP form payload; reject wrong shapes. */
export function mcpFormFields(
  fields: Record<string, unknown>,
  operation: string
): McpFormFields {
  const out: McpFormFields = {}
  const command = fields['command']
  if (command !== undefined) {
    if (typeof command !== 'string') {
      throw new AppOperationError('invalid-request', operation, 'Field command must be a string')
    }
    out.command = command
  }
  const args = fields['args']
  if (args !== undefined) {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new AppOperationError(
        'invalid-request',
        operation,
        'Field args must be an array of strings'
      )
    }
    out.args = args as string[]
  }
  const env = fields['env']
  if (env !== undefined) {
    if (
      env === null ||
      typeof env !== 'object' ||
      Array.isArray(env) ||
      Object.values(env).some((value) => typeof value !== 'string')
    ) {
      throw new AppOperationError(
        'invalid-request',
        operation,
        'Field env must map string keys to string values'
      )
    }
    out.env = env as Record<string, string>
  }
  return out
}

/** Equal string records regardless of key order. */
export function sameStringRecord(
  a: Record<string, unknown>,
  b: Record<string, string>
): boolean {
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (aKeys.join('\0') !== bKeys.join('\0')) return false
  return aKeys.every((key) => a[key] === b[key])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/shared/edit.ts src/main/providers/shared/edit.test.ts
git commit -m "feat: shared markdown edit planner and mcp field narrowing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Codex edit module — agent TOML and MCP entry planners

**Files:**

- Create: `src/main/providers/codex/edit.ts`
- Create: `src/main/providers/codex/edit.test.ts`

**Interfaces:**

- Consumes: Task 1's `editTomlValue`, `setTomlValue`, `deleteTomlKey`, `hasTomlKeyValue`, `hasTomlTable`, `serializeTomlValue`; Task 5's `mcpFormFields`, `stringFields`, `sameStringRecord`; `getStaticTOMLValue`, `parseTOML`; `stringField` from `../shared/document`; `missingFieldDiagnostics` from `../shared/document`; `AppOperationError`.
- Produces: `applyCodexAgentFormEdit(source, fields, operation): string`, `applyCodexMcpFormEdit(source, entryKey, fields, operation): string`, `validateCodexAgentContent(content, path): ValidationResult`, `validateCodexMcpContent(content, entryKey, path): ValidationResult`. Consumed by Task 8 (codex adapter).

- [ ] **Step 1: Write the failing tests `src/main/providers/codex/edit.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { AppOperationError } from '../../errors'
import {
  applyCodexAgentFormEdit,
  applyCodexMcpFormEdit,
  validateCodexAgentContent,
  validateCodexMcpContent
} from './edit'

const AGENT = `# codex agent
name = "helper"
description = "Helps" # keep
developer_instructions = "Be nice"
`

const CONFIG = `model = "gpt-5.5"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.github.env]
GITHUB_TOKEN = "abc"

[mcp_servers.inline]
command = "bunx"
env = { A = "1" }
`

describe('applyCodexAgentFormEdit', () => {
  it('replaces only changed fields, preserving comments', () => {
    const result = applyCodexAgentFormEdit(
      AGENT,
      { name: 'helper', description: 'Helps a lot' },
      'op'
    )
    expect(result).toBe(AGENT.replace('"Helps"', '"Helps a lot"'))
  })

  it('inserts a field that does not exist yet', () => {
    const result = applyCodexAgentFormEdit('name = "x"\n', { description: 'D' }, 'op')
    expect(result).toBe('name = "x"\ndescription = "D"\n')
  })

  it('rejects editing an unparseable file', () => {
    expect(() => applyCodexAgentFormEdit('name = [broken', { name: 'x' }, 'op')).toThrowError(
      AppOperationError
    )
  })
})

describe('applyCodexMcpFormEdit', () => {
  it('changes command inside one entry only', () => {
    const result = applyCodexMcpFormEdit(CONFIG, 'github', { command: 'bunx' }, 'op')
    expect(result).toBe(CONFIG.replace('command = "npx"', 'command = "bunx"'))
  })

  it('edits env keys in a sub-table: set, add, delete', () => {
    const result = applyCodexMcpFormEdit(
      CONFIG,
      'github',
      { env: { GITHUB_TOKEN: 'xyz', NEW_VAR: '1' } },
      'op'
    )
    expect(result).toContain('GITHUB_TOKEN = "xyz"')
    expect(result).toContain('NEW_VAR = "1"')
    const removed = applyCodexMcpFormEdit(CONFIG, 'github', { env: {} }, 'op')
    expect(removed).not.toContain('GITHUB_TOKEN')
    expect(removed).toContain('[mcp_servers.github.env]')
  })

  it('replaces an inline env wholesale', () => {
    const result = applyCodexMcpFormEdit(CONFIG, 'inline', { env: { A: '2', B: '3' } }, 'op')
    expect(result).toBe(CONFIG.replace('env = { A = "1" }', 'env = { A = "2", B = "3" }'))
  })

  it('inserts an inline env when none exists', () => {
    const result = applyCodexMcpFormEdit(CONFIG, 'github', { env: undefined }, 'op')
    expect(result).toBe(CONFIG) // no env in the form -> untouched
    const withEnv = `[mcp_servers.solo]\ncommand = "x"\n`
    expect(applyCodexMcpFormEdit(withEnv, 'solo', { env: { K: 'v' } }, 'op')).toBe(
      `[mcp_servers.solo]\ncommand = "x"\nenv = { K = "v" }\n`
    )
  })

  it('replaces args as a whole array and skips unchanged args', () => {
    const result = applyCodexMcpFormEdit(CONFIG, 'github', { args: ['-y', 'other'] }, 'op')
    expect(result).toBe(
      CONFIG.replace(
        'args = ["-y", "@modelcontextprotocol/server-github"]',
        'args = ["-y", "other"]'
      )
    )
    expect(
      applyCodexMcpFormEdit(
        CONFIG,
        'github',
        { args: ['-y', '@modelcontextprotocol/server-github'] },
        'op'
      )
    ).toBe(CONFIG)
  })

  it('throws not-found for a missing entry', () => {
    try {
      applyCodexMcpFormEdit(CONFIG, 'nope', { command: 'x' }, 'op')
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('not-found')
    }
  })
})

describe('validateCodexAgentContent', () => {
  it('accepts a healthy agent and flags missing description', () => {
    expect(validateCodexAgentContent(AGENT, '/a.toml').ok).toBe(true)
    const missing = validateCodexAgentContent('name = "x"\n', '/a.toml')
    expect(missing.ok).toBe(true)
    expect(missing.diagnostics).toEqual([
      { severity: 'warning', message: 'Missing required field: description', path: '/a.toml' }
    ])
  })

  it('rejects invalid TOML', () => {
    const result = validateCodexAgentContent('name = [broken', '/a.toml')
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.message).toContain('Invalid TOML')
  })
})

describe('validateCodexMcpContent', () => {
  it('accepts a healthy entry', () => {
    expect(validateCodexMcpContent(CONFIG, 'github', '/c.toml')).toEqual({
      ok: true,
      diagnostics: []
    })
  })

  it('errors when command and url are both missing', () => {
    const noCommand = `[mcp_servers.x]\nargs = ["a"]\n`
    const result = validateCodexMcpContent(noCommand, 'x', '/c.toml')
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.message).toContain('command')
  })

  it('errors on bad args or env shapes and missing entries', () => {
    expect(validateCodexMcpContent(`[mcp_servers.x]\ncommand = "c"\nargs = "no"\n`, 'x', '/c.toml').ok).toBe(false)
    expect(validateCodexMcpContent(`[mcp_servers.x]\ncommand = "c"\nenv = 3\n`, 'x', '/c.toml').ok).toBe(false)
    expect(validateCodexMcpContent(CONFIG, 'nope', '/c.toml').ok).toBe(false)
    expect(validateCodexMcpContent('broken = [', 'x', '/c.toml').ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./edit`.

- [ ] **Step 3: Implement `src/main/providers/codex/edit.ts`**

```ts
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'
import type { Diagnostic, ValidationResult } from '../../../shared/resource'
import { AppOperationError } from '../../errors'
import {
  deleteTomlKey,
  editTomlValue,
  hasTomlKeyValue,
  hasTomlTable,
  serializeTomlValue,
  setTomlValue
} from '../../fidelity/toml-edit'
import { missingFieldDiagnostics, stringField } from '../shared/document'
import { mcpFormFields, sameStringRecord, stringFields } from '../shared/edit'

function staticTable(source: string): Record<string, unknown> | null {
  try {
    const value: unknown = getStaticTOMLValue(parseTOML(source))
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Form edit of a Codex agent: top-level string fields, changed keys only. */
export function applyCodexAgentFormEdit(
  source: string,
  fields: Record<string, unknown>,
  operation: string
): string {
  const editable = stringFields(fields, ['name', 'description', 'developer_instructions'], operation)
  const current = staticTable(source)
  if (current === null) {
    throw new AppOperationError(
      'invalid-request',
      operation,
      'Cannot form-edit an unparseable TOML file; fix the source first'
    )
  }
  let out = source
  for (const [key, value] of Object.entries(editable)) {
    if (current[key] === value) continue
    out = setTomlValue(out, [], key, value)
  }
  return out
}

function applyEnvEdit(
  source: string,
  entryPath: string[],
  currentEntry: Record<string, unknown>,
  env: Record<string, string>
): string {
  const envPath = [...entryPath, 'env']
  const current = record(currentEntry['env']) ?? {}
  if (sameStringRecord(current, env)) return source
  if (hasTomlKeyValue(source, envPath)) {
    // Inline env table: replace the whole value span (comments inside it are
    // lost; everything outside the span is untouched by construction).
    return editTomlValue(source, envPath, serializeTomlValue(env))
  }
  if (hasTomlTable(source, envPath)) {
    let out = source
    for (const key of Object.keys(current)) {
      if (!(key in env)) out = deleteTomlKey(out, envPath, key)
    }
    for (const [key, value] of Object.entries(env)) {
      if (current[key] !== value) out = setTomlValue(out, envPath, key, value)
    }
    return out
  }
  return setTomlValue(source, entryPath, 'env', env)
}

/** Form edit of one MCP server entry in config.toml. */
export function applyCodexMcpFormEdit(
  source: string,
  entryKey: string,
  fields: Record<string, unknown>,
  operation: string
): string {
  const form = mcpFormFields(fields, operation)
  const servers = record(staticTable(source)?.['mcp_servers'])
  const entry = record(servers?.[entryKey])
  if (!entry) {
    throw new AppOperationError('not-found', operation, `MCP server entry not found: ${entryKey}`)
  }
  const entryPath = ['mcp_servers', entryKey]
  let out = source
  // An empty command is skipped rather than written: url-only remote servers
  // legitimately have no command, and `command = ""` would be worse.
  if (form.command !== undefined && form.command !== '' && form.command !== entry['command']) {
    out = setTomlValue(out, entryPath, 'command', form.command)
  }
  if (
    form.args !== undefined &&
    JSON.stringify(form.args) !== JSON.stringify(entry['args'] ?? [])
  ) {
    out = setTomlValue(out, entryPath, 'args', form.args)
  }
  if (form.env !== undefined) {
    out = applyEnvEdit(out, entryPath, entry, form.env)
  }
  return out
}

/** Validate proposed Codex agent TOML content. */
export function validateCodexAgentContent(content: string, path: string): ValidationResult {
  const diagnostics: Diagnostic[] = []
  let fields: Record<string, unknown> = {}
  try {
    fields = record(getStaticTOMLValue(parseTOML(content))) ?? {}
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      message: `Invalid TOML: ${error instanceof Error ? error.message : String(error)}`,
      path
    })
  }
  if (diagnostics.length === 0) {
    diagnostics.push(...missingFieldDiagnostics(fields, ['name', 'description'], path))
  }
  return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics }
}

/** Validate a proposed config.toml against one MCP server entry. */
export function validateCodexMcpContent(
  content: string,
  entryKey: string,
  path: string
): ValidationResult {
  const diagnostics: Diagnostic[] = []
  let entry: Record<string, unknown> | null = null
  try {
    const servers = record(record(getStaticTOMLValue(parseTOML(content)))?.['mcp_servers'])
    entry = record(servers?.[entryKey])
    if (!entry) {
      diagnostics.push({
        severity: 'error',
        message: `Server entry not present: ${entryKey}`,
        path
      })
    }
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      message: `Invalid TOML: ${error instanceof Error ? error.message : String(error)}`,
      path
    })
  }
  if (entry) {
    if (stringField(entry, 'command') === undefined && stringField(entry, 'url') === undefined) {
      diagnostics.push({
        severity: 'error',
        message: 'Server needs a command (or url for remote servers)',
        path
      })
    }
    const args = entry['args']
    if (args !== undefined && (!Array.isArray(args) || args.some((a) => typeof a !== 'string'))) {
      diagnostics.push({ severity: 'error', message: 'args must be an array of strings', path })
    }
    const env = entry['env']
    if (
      env !== undefined &&
      (record(env) === null || Object.values(record(env) ?? {}).some((v) => typeof v !== 'string'))
    ) {
      diagnostics.push({
        severity: 'error',
        message: 'env must map string keys to string values',
        path
      })
    }
  }
  return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/codex/edit.ts src/main/providers/codex/edit.test.ts
git commit -m "feat: codex agent and mcp entry edit planners with validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Claude edit module — MCP entry planner

**Files:**

- Create: `src/main/providers/claude/edit.ts`
- Create: `src/main/providers/claude/edit.test.ts`

**Interfaces:**

- Consumes: M1's `editJsonValue` from `src/main/fidelity/jsonc-edit.ts`; `parse` (with `ParseError[]`) from `jsonc-parser`; Task 5's `mcpFormFields`, `sameStringRecord`; `stringField` from `../shared/document`; `AppOperationError`.
- Produces: `applyClaudeMcpFormEdit(source, entryKey, fields, operation): string`, `validateClaudeMcpContent(content, entryKey, path): ValidationResult`. Claude's markdown kinds (agents, skills, commands, instructions) need no module here — Task 5's shared functions cover them. Consumed by Task 8 (claude adapter).

- [ ] **Step 1: Write the failing tests `src/main/providers/claude/edit.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { AppOperationError } from '../../errors'
import { applyClaudeMcpFormEdit, validateClaudeMcpContent } from './edit'

const CONFIG = `{
  // user mcp config
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "abc" }
    },
    "plain": {
      "command": "bunx"
    }
  },
  "otherSetting": true
}
`

describe('applyClaudeMcpFormEdit', () => {
  it('changes command for one entry, preserving comments and other keys', () => {
    const result = applyClaudeMcpFormEdit(CONFIG, 'github', { command: 'bunx' }, 'op')
    expect(result).toContain('// user mcp config')
    expect(result).toContain('"otherSetting": true')
    expect(result).toContain('"command": "bunx"')
    expect(result).not.toContain('"command": "npx"')
  })

  it('replaces env and removes it when emptied', () => {
    const replaced = applyClaudeMcpFormEdit(CONFIG, 'github', { env: { A: '1' } }, 'op')
    expect(replaced).toContain('"A": "1"')
    expect(replaced).not.toContain('GITHUB_TOKEN')
    const removed = applyClaudeMcpFormEdit(CONFIG, 'github', { env: {} }, 'op')
    expect(removed).not.toContain('"env"')
    // emptying env on an entry that never had one is a no-op
    expect(applyClaudeMcpFormEdit(CONFIG, 'plain', { env: {} }, 'op')).toBe(CONFIG)
  })

  it('skips unchanged values entirely', () => {
    expect(
      applyClaudeMcpFormEdit(
        CONFIG,
        'github',
        {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'abc' }
        },
        'op'
      )
    ).toBe(CONFIG)
  })

  it('throws not-found for a missing entry and invalid-request for a malformed file', () => {
    try {
      applyClaudeMcpFormEdit(CONFIG, 'nope', { command: 'x' }, 'op')
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('not-found')
    }
    try {
      applyClaudeMcpFormEdit('{ "mcpServers": {', 'x', { command: 'c' }, 'op')
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('invalid-request')
    }
  })
})

describe('validateClaudeMcpContent', () => {
  it('accepts a healthy entry', () => {
    expect(validateClaudeMcpContent(CONFIG, 'github', '/c.json')).toEqual({
      ok: true,
      diagnostics: []
    })
  })

  it('errors on malformed JSON, missing entry, missing command/url, bad shapes', () => {
    expect(validateClaudeMcpContent('{ broken', 'x', '/c.json').ok).toBe(false)
    expect(validateClaudeMcpContent(CONFIG, 'nope', '/c.json').ok).toBe(false)
    expect(
      validateClaudeMcpContent('{ "mcpServers": { "x": { "args": [] } } }', 'x', '/c.json').ok
    ).toBe(false)
    expect(
      validateClaudeMcpContent('{ "mcpServers": { "x": { "command": "c", "args": "no" } } }', 'x', '/c.json').ok
    ).toBe(false)
    expect(
      validateClaudeMcpContent('{ "mcpServers": { "x": { "command": "c", "env": { "A": 1 } } } }', 'x', '/c.json').ok
    ).toBe(false)
  })

  it('accepts a url-only remote server', () => {
    expect(
      validateClaudeMcpContent('{ "mcpServers": { "x": { "url": "https://mcp.example" } } }', 'x', '/c.json').ok
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./edit`.

- [ ] **Step 3: Implement `src/main/providers/claude/edit.ts`**

```ts
import { parse, type ParseError } from 'jsonc-parser'
import type { Diagnostic, ValidationResult } from '../../../shared/resource'
import { AppOperationError } from '../../errors'
import { editJsonValue } from '../../fidelity/jsonc-edit'
import { stringField } from '../shared/document'
import { mcpFormFields, sameStringRecord } from '../shared/edit'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseConfig(content: string): { config: Record<string, unknown> | null; broken: boolean } {
  const errors: ParseError[] = []
  const value: unknown = parse(content, errors, { allowTrailingComma: true })
  if (errors.length > 0) return { config: null, broken: true }
  return { config: record(value), broken: false }
}

/** Form edit of one MCP server entry in ~/.claude.json or <project>/.mcp.json. */
export function applyClaudeMcpFormEdit(
  source: string,
  entryKey: string,
  fields: Record<string, unknown>,
  operation: string
): string {
  const form = mcpFormFields(fields, operation)
  const { config, broken } = parseConfig(source)
  if (broken || config === null) {
    throw new AppOperationError(
      'invalid-request',
      operation,
      'Cannot form-edit a malformed JSON file; fix the source first'
    )
  }
  const entry = record(record(config['mcpServers'])?.[entryKey])
  if (!entry) {
    throw new AppOperationError('not-found', operation, `MCP server entry not found: ${entryKey}`)
  }
  let out = source
  // An empty command is skipped rather than written (url-only remote servers).
  if (form.command !== undefined && form.command !== '' && form.command !== entry['command']) {
    out = editJsonValue(out, ['mcpServers', entryKey, 'command'], form.command)
  }
  if (
    form.args !== undefined &&
    JSON.stringify(form.args) !== JSON.stringify(entry['args'] ?? [])
  ) {
    out = editJsonValue(out, ['mcpServers', entryKey, 'args'], form.args)
  }
  if (form.env !== undefined) {
    const currentEnv = record(entry['env']) ?? {}
    if (!sameStringRecord(currentEnv, form.env)) {
      const empty = Object.keys(form.env).length === 0
      if (empty && entry['env'] === undefined) {
        // nothing to remove
      } else {
        // undefined value removes the property (jsonc-parser modify semantics)
        out = editJsonValue(out, ['mcpServers', entryKey, 'env'], empty ? undefined : form.env)
      }
    }
  }
  return out
}

/** Validate a proposed MCP config file against one server entry. */
export function validateClaudeMcpContent(
  content: string,
  entryKey: string,
  path: string
): ValidationResult {
  const diagnostics: Diagnostic[] = []
  const { config, broken } = parseConfig(content)
  const entry = broken ? null : record(record(config?.['mcpServers'])?.[entryKey])
  if (broken) {
    diagnostics.push({ severity: 'error', message: 'Invalid JSON', path })
  } else if (!entry) {
    diagnostics.push({
      severity: 'error',
      message: `Server entry not present: ${entryKey}`,
      path
    })
  } else {
    if (stringField(entry, 'command') === undefined && stringField(entry, 'url') === undefined) {
      diagnostics.push({
        severity: 'error',
        message: 'Server needs a command (or url for remote servers)',
        path
      })
    }
    const args = entry['args']
    if (args !== undefined && (!Array.isArray(args) || args.some((a) => typeof a !== 'string'))) {
      diagnostics.push({ severity: 'error', message: 'args must be an array of strings', path })
    }
    const env = entry['env']
    if (
      env !== undefined &&
      (record(env) === null || Object.values(record(env) ?? {}).some((v) => typeof v !== 'string'))
    ) {
      diagnostics.push({
        severity: 'error',
        message: 'env must map string keys to string values',
        path
      })
    }
  }
  return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/claude/edit.ts src/main/providers/claude/edit.test.ts
git commit -m "feat: claude mcp entry edit planner with validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Adapter validate/plan wiring

**Files:**

- Modify: `src/main/providers/codex.ts`
- Modify: `src/main/providers/claude.ts`
- Modify: `src/main/providers/adapters.test.ts`

**Interfaces:**

- Consumes: Tasks 5–7 planners/validators; `decodeResourceId` from `./shared/resource-id`; `readTextFile` from `./shared/scan`; Task 3's `ResourceDraft` extensions.
- Produces: working `adapter.validate(draft)` and `adapter.plan(change)` on both adapters. Contract for `plan`: only `change.kind === 'update'` with `resourceId` + `draft` is accepted; the adapter decodes the id, reads the current file, and returns `{ operations: [{ kind: 'write', path, content }] }` where `content` is the full new file body. Source-mode edits (`draft.raw` defined) of `mcp-servers` throw `invalid-request`; `create`/`delete` change kinds throw `not-implemented` ("Arrives in Milestone 4."). Contract for `validate`: validates `draft.raw` (the PLANNED full file content) for `draft.kind`, using `draft.entryKey` for MCP entries and `draft.sourcePath ?? ''` as the diagnostics path; a draft without `raw` returns `{ ok: false, diagnostics: [error 'Draft has no planned content'] }`. Consumed by Task 11 (ResourceService calls `plan` then `validate({ ...draft, raw: plannedContent })`).

- [ ] **Step 1: Extend `src/main/providers/adapters.test.ts` with failing tests**

First run `grep -n "not-implemented\|not implemented" src/main/providers/adapters.test.ts` — if existing tests assert that `validate`/`plan` throw `not-implemented`, DELETE those assertions (the behavior changes in this task). Keep `detect`/`capabilities`/`discover` tests untouched.

Append (adapt the fixture-root constants to the ones already used in this file — it already builds adapters against `tests/fixtures/discovery`):

```ts
import { encodeResourceId } from './shared/resource-id'

describe('claude adapter plan/validate', () => {
  const agentPath = join(FIXTURES, 'claude-user', 'agents', 'code-reviewer.md')
  const resourceId = encodeResourceId({
    provider: 'claude',
    kind: 'agents',
    scope: 'user',
    path: agentPath
  })
  const adapter = createClaudeAdapter({
    configRoot: join(FIXTURES, 'claude-user'),
    userMcpPath: join(FIXTURES, 'claude-user.json')
  })

  it('plans a form update as a single full-content write', async () => {
    const plan = await adapter.plan({
      kind: 'update',
      resourceId,
      draft: {
        provider: 'claude',
        kind: 'agents',
        scope: 'user',
        sourcePath: agentPath,
        fields: { name: 'renamed', description: 'Reviews pull requests for style issues' }
      }
    })
    expect(plan.operations).toHaveLength(1)
    expect(plan.operations[0]).toMatchObject({ kind: 'write', path: agentPath })
    expect(plan.operations[0]?.content).toContain('name: renamed')
    expect(plan.operations[0]?.content).toContain('meticulous')
  })

  it('validates planned content', async () => {
    const good = await adapter.validate({
      provider: 'claude',
      kind: 'agents',
      scope: 'user',
      sourcePath: agentPath,
      fields: {},
      raw: '---\nname: a\ndescription: b\n---\nBody\n'
    })
    expect(good).toEqual({ ok: true, diagnostics: [] })
    const bad = await adapter.validate({
      provider: 'claude',
      kind: 'agents',
      scope: 'user',
      sourcePath: agentPath,
      fields: {},
      raw: '---\nname: [broken\n---\nBody\n'
    })
    expect(bad.ok).toBe(false)
  })

  it('rejects source edits of mcp entries and non-update changes', async () => {
    const mcpId = encodeResourceId({
      provider: 'claude',
      kind: 'mcp-servers',
      scope: 'user',
      path: join(FIXTURES, 'claude-user.json'),
      entryKey: 'github'
    })
    await expect(
      adapter.plan({
        kind: 'update',
        resourceId: mcpId,
        draft: {
          provider: 'claude',
          kind: 'mcp-servers',
          scope: 'user',
          entryKey: 'github',
          fields: {},
          raw: '{}'
        }
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(adapter.plan({ kind: 'create' })).rejects.toMatchObject({
      code: 'not-implemented'
    })
  })
})

describe('codex adapter plan/validate', () => {
  const adapter = createCodexAdapter({ configRoot: join(FIXTURES, 'codex-user') })

  it('plans an mcp env form update via the shared config file', async () => {
    const configPath = join(FIXTURES, 'codex-user', 'config.toml')
    const resourceId = encodeResourceId({
      provider: 'codex',
      kind: 'mcp-servers',
      scope: 'user',
      path: configPath,
      entryKey: 'github'
    })
    const plan = await adapter.plan({
      kind: 'update',
      resourceId,
      draft: {
        provider: 'codex',
        kind: 'mcp-servers',
        scope: 'user',
        entryKey: 'github',
        sourcePath: configPath,
        fields: { command: 'bunx' }
      }
    })
    expect(plan.operations[0]?.path).toBe(configPath)
    expect(plan.operations[0]?.content).toContain('command = "bunx"')
  })
})
```

Note: if `tests/fixtures/discovery/codex-user/config.toml` does not exist yet (check!), create it as part of this step:

```toml
model = "gpt-5.5"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
```

If the codex adapter tests in this file already use a different fixture location for `config.toml`, reuse that instead — the M2 suite already covers codex MCP discovery, so a config fixture very likely exists.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `validate`/`plan` still throw `not-implemented`.

- [ ] **Step 3: Implement in `src/main/providers/codex.ts`**

Replace the `notImplemented`-based `validate`/`plan` with (add the imports shown):

```ts
import type { ResourceChange, ResourceDraft, ValidationResult, FileOperationPlan } from '../../shared/resource'
import { decodeResourceId, type ResourceRef } from './shared/resource-id'
import { readTextFile } from './shared/scan'
import { applyMarkdownFormEdit, validateMarkdownContent } from './shared/edit'
import {
  applyCodexAgentFormEdit,
  applyCodexMcpFormEdit,
  validateCodexAgentContent,
  validateCodexMcpContent
} from './codex/edit'

function planContent(ref: ResourceRef, raw: string, draft: ResourceDraft, operation: string): string {
  if (draft.raw !== undefined) {
    if (ref.kind === 'mcp-servers') {
      throw new AppOperationError(
        'invalid-request',
        operation,
        'MCP server entries are form-edited only in Milestone 3'
      )
    }
    return draft.raw
  }
  switch (ref.kind) {
    case 'agents':
      return applyCodexAgentFormEdit(raw, draft.fields, operation)
    case 'skills':
    case 'instructions':
      return applyMarkdownFormEdit(raw, ref.kind, draft.fields, draft.body, operation)
    case 'mcp-servers': {
      if (ref.entryKey === undefined) {
        throw new AppOperationError(
          'invalid-request',
          operation,
          'Cannot edit a malformed MCP configuration'
        )
      }
      return applyCodexMcpFormEdit(raw, ref.entryKey, draft.fields, operation)
    }
    default:
      throw new AppOperationError('invalid-request', operation, `Unknown resource kind: ${ref.kind}`)
  }
}
```

And inside the adapter object:

```ts
    async validate(draft): Promise<ValidationResult> {
      const path = draft.sourcePath ?? ''
      if (draft.raw === undefined) {
        return {
          ok: false,
          diagnostics: [{ severity: 'error', message: 'Draft has no planned content' }]
        }
      }
      switch (draft.kind) {
        case 'agents':
          return validateCodexAgentContent(draft.raw, path)
        case 'skills':
          return validateMarkdownContent('skills', draft.raw, path)
        case 'instructions':
          return validateMarkdownContent('instructions', draft.raw, path)
        case 'mcp-servers':
          return draft.entryKey === undefined
            ? {
                ok: false,
                diagnostics: [
                  { severity: 'error', message: 'Cannot validate a malformed MCP configuration' }
                ]
              }
            : validateCodexMcpContent(draft.raw, draft.entryKey, path)
        default:
          return {
            ok: false,
            diagnostics: [{ severity: 'error', message: `Unknown resource kind: ${draft.kind}` }]
          }
      }
    },
    async plan(change: ResourceChange): Promise<FileOperationPlan> {
      if (change.kind !== 'update') {
        throw new AppOperationError('not-implemented', 'codex:plan', 'Arrives in Milestone 4.')
      }
      if (!change.resourceId || !change.draft) {
        throw new AppOperationError('invalid-request', 'codex:plan', 'Update needs a resource id and a draft')
      }
      const ref = decodeResourceId(change.resourceId)
      const raw = readTextFile(ref.path)
      if (raw === null) {
        throw new AppOperationError('not-found', 'codex:plan', `Source file could not be read: ${ref.path}`, { path: ref.path })
      }
      const content = planContent(ref, raw, change.draft, 'codex:plan')
      return { operations: [{ kind: 'write', path: ref.path, content }] }
    }
```

Remove the now-unused `notImplemented` helper from `codex.ts` **only if** nothing else references it — `claude.ts` imports `AdapterOptions` from this file but has its own helper; check with `grep -n "notImplemented" src/main/providers/*.ts`.

- [ ] **Step 4: Implement in `src/main/providers/claude.ts`**

Same structure, Claude kinds. `planContent` for Claude:

```ts
function planContent(ref: ResourceRef, raw: string, draft: ResourceDraft, operation: string): string {
  if (draft.raw !== undefined) {
    if (ref.kind === 'mcp-servers') {
      throw new AppOperationError(
        'invalid-request',
        operation,
        'MCP server entries are form-edited only in Milestone 3'
      )
    }
    return draft.raw
  }
  switch (ref.kind) {
    case 'agents':
    case 'skills':
    case 'commands':
    case 'instructions':
      return applyMarkdownFormEdit(raw, ref.kind, draft.fields, draft.body, operation)
    case 'mcp-servers': {
      if (ref.entryKey === undefined) {
        throw new AppOperationError(
          'invalid-request',
          operation,
          'Cannot edit a malformed MCP configuration'
        )
      }
      return applyClaudeMcpFormEdit(raw, ref.entryKey, draft.fields, operation)
    }
    default:
      throw new AppOperationError('invalid-request', operation, `Unknown resource kind: ${ref.kind}`)
  }
}
```

`validate` dispatch: `agents`/`skills`/`commands`/`instructions` → `validateMarkdownContent(kind, draft.raw, path)`; `mcp-servers` → `validateClaudeMcpContent(draft.raw, draft.entryKey, path)` with the same malformed-config guard as codex; same no-raw and unknown-kind fallbacks. `plan` is identical to codex's except the operation string is `'claude:plan'`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/providers/codex.ts src/main/providers/claude.ts src/main/providers/adapters.test.ts tests/fixtures/discovery
git commit -m "feat: adapters implement validate and plan for updates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: BackupService and SQLite migration

**Files:**

- Modify: `src/main/services/db.ts` (append migration)
- Create: `src/main/services/backups.ts`
- Create: `src/main/services/backups.test.ts`

**Interfaces:**

- Consumes: `DatabaseSync` from `node:sqlite`; `randomUUID` from `node:crypto`; Task 3's `sha256Hex`; Task 4's `BackupEntry` type from `src/shared/ipc.ts`; `AppOperationError`.
- Produces: `BackupTarget { resourceId: string; resourceName: string; provider: ProviderId; kind: string }`, `BackupFileContent { path: string; content: string | null }` (null = file did not exist), `BackupService` with `record(target, operation: 'update' | 'restore', files: BackupFileContent[]): string` (returns backupId; prunes to 50 per resource), `setHashAfter(backupId, path, hash): void`, `list(resourceId?): BackupEntry[]` (newest first by rowid), `get(backupId): { target: BackupTarget; operation: 'update' | 'restore'; files: BackupFileContent[] }` (throws `not-found`). Consumed by Tasks 10–11.

- [ ] **Step 1: Append the migration to `src/main/services/db.ts`**

Append a second element to the `MIGRATIONS` array:

```ts
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
```

- [ ] **Step 2: Write the failing tests `src/main/services/backups.test.ts`**

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./backups`.

- [ ] **Step 4: Implement `src/main/services/backups.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { BackupEntry } from '../../shared/ipc'
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

  record(target: BackupTarget, operation: 'update' | 'restore', files: BackupFileContent[]): string {
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
        operation: record['operation'] as 'update' | 'restore',
        paths: pathsFor.all(id).map((p) => String((p as Record<string, unknown>)['path'])),
        createdAt: String(record['created_at'])
      }
    })
  }

  get(backupId: string): {
    target: BackupTarget
    operation: 'update' | 'restore'
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
      operation: row['operation'] as 'update' | 'restore',
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS. If the prune test fails on `get` NOT throwing: verify `PRAGMA foreign_keys = ON` runs in `openDatabase` (it does) so the cascade delete removes `backup_files` rows.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/db.ts src/main/services/backups.ts src/main/services/backups.test.ts
git commit -m "feat: backup service with sqlite metadata and 50-per-resource retention

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: TransactionService — allow-list, conflicts, atomic writes

**Files:**

- Create: `src/main/services/transactions.ts`
- Create: `src/main/services/transactions.test.ts`

**Interfaces:**

- Consumes: Task 9's `BackupService`, `BackupTarget`; Task 3's `sha256Hex`, `FileFingerprint`; `FileOperation` from shared; `readTextFile` from `../providers/shared/scan`; `AppOperationError`.
- Produces: `AllowedWriteLocations { roots(): string[]; files(): string[] }`, `TransactionOptions { base?: FileFingerprint[]; operation: 'update' | 'restore' }` (omit `base` to skip conflict checks — restore), `TransactionService` with `apply(target: BackupTarget, operations: FileOperation[], options: TransactionOptions): { backupId: string }`. Supports `write` and `delete` operations only; `move`/`mkdir` → `invalid-request`. Consumed by Task 11.

- [ ] **Step 1: Write the failing tests `src/main/services/transactions.test.ts`**

```ts
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
      service.apply(TARGET, [{ kind: 'move', path: join(root, 'a'), toPath: join(root, 'b') }], {
        operation: 'update'
      })
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('invalid-request')
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./transactions`.

- [ ] **Step 3: Implement `src/main/services/transactions.ts`**

```ts
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
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
  operation: 'update' | 'restore'
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
    for (const operation of operations) {
      if (operation.kind !== 'write' && operation.kind !== 'delete') {
        throw new AppOperationError(
          'invalid-request',
          'resources:apply',
          `Unsupported file operation in Milestone 3: ${operation.kind}`
        )
      }
      if (operation.kind === 'write' && operation.content === undefined) {
        throw new AppOperationError('invalid-request', 'resources:apply', `Write without content: ${operation.path}`)
      }
      this.assertAllowed(operation.path)
    }

    const snapshots = operations.map((operation) => ({
      path: operation.path,
      content: readTextFile(operation.path)
    }))

    if (options.base !== undefined) {
      for (const snapshot of snapshots) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS. macOS note: temp dirs live under symlinked paths (`/var` → `/private/var`); the tests pass because BOTH the candidate path and the allowed roots go through `realTarget` before comparison.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/transactions.ts src/main/services/transactions.test.ts
git commit -m "feat: transaction service with allow-list, conflicts, atomic writes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: ResourceService write path, IPC handlers, main wiring

**Files:**

- Modify: `package.json` (add `diff` dependency, `@types/diff` dev dependency)
- Modify: `src/main/services/resources.ts`
- Modify: `src/main/services/resources.test.ts` (constructor changed; new end-to-end suites)
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/index.ts`

**Interfaces:**

- Consumes: everything from Tasks 3–10.
- Produces: `ResourceService` constructor becomes `(registry, projects, transactions: TransactionService, backups: BackupService)`; new methods `validate(edit: ResourceEdit): Promise<ValidationResult>`, `preview(edit: ResourceEdit): Promise<ChangePreview>`, `apply(edit: ResourceEdit): Promise<{ document: ResourceDocument; backupId: string }>`, `restore(backupId: string): Promise<{ document: ResourceDocument | null; backupId: string }>`. `HandlerDeps` gains `backups: BackupService`. Five channels handled. Consumed by Tasks 13–14 (renderer).

- [ ] **Step 1: Add the diff dependency**

Run: `bun add diff && bun add -d @types/diff`
Expected: `diff` appears in `dependencies` (main process; electron-vite externalizes it), `@types/diff` in `devDependencies`.

- [ ] **Step 2: Extend the tests in `src/main/services/resources.test.ts`**

The constructor gains two arguments, so first update every existing `new ResourceService(registry, projects)` in this file to the new signature by adding, in the test setup, a temp-dir-backed pair:

```ts
const backups = new BackupService(openDatabase(join(tmp, 'test.db')), join(tmp, 'backups'))
const transactions = new TransactionService(
  { roots: () => [tmp], files: () => [] },
  backups
)
const service = new ResourceService(registry, projects, transactions, backups)
```

Mirror the file's existing setup style (it already builds a registry over `tests/fixtures/discovery` and a `ProjectsStore`). Because M3 tests WRITE, the new suites must not touch `tests/fixtures` — copy the fixture content into a `mkdtempSync` root per test run and point a fresh `createClaudeAdapter({ configRoot, userMcpPath })` at it, with the transaction roots covering that temp root.

Append this suite (adjust helper names to the file's conventions):

```ts
describe('ResourceService write path', () => {
  let tmp: string
  let agentPath: string
  let service: ResourceService
  let backups: BackupService

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agent-control-write-'))
    mkdirSync(join(tmp, 'claude', 'agents'), { recursive: true })
    agentPath = join(tmp, 'claude', 'agents', 'reviewer.md')
    writeFileSync(
      agentPath,
      '---\nname: reviewer\ndescription: Reviews PRs\n---\n\nBe thorough.\n'
    )
    const registry = new ProviderRegistry()
    registry.register(
      createClaudeAdapter({ configRoot: join(tmp, 'claude'), userMcpPath: join(tmp, 'claude.json') })
    )
    const projects = new ProjectsStore(openDatabase(join(tmp, 'projects.db')))
    backups = new BackupService(openDatabase(join(tmp, 'backups.db')), join(tmp, 'backups'))
    const transactions = new TransactionService({ roots: () => [tmp], files: () => [] }, backups)
    service = new ResourceService(registry, projects, transactions, backups)
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  async function readAgent() {
    const summaries = await service.list({ providerId: 'claude', kind: 'agents' })
    return service.read(summaries[0]!.id)
  }

  function formEdit(doc: ResourceDocument, description: string): ResourceEdit {
    return {
      resourceId: doc.id,
      base: doc.fingerprints,
      edit: { mode: 'form', fields: { name: 'reviewer', description }, body: '\nBe thorough.\n' }
    }
  }

  it('read returns fingerprints for the source file', async () => {
    const doc = await readAgent()
    expect(doc.fingerprints).toHaveLength(1)
    expect(doc.fingerprints[0]?.path).toBe(agentPath)
    expect(doc.fingerprints[0]?.hash).toHaveLength(64)
  })

  it('previews a form edit with a unified diff and no conflicts', async () => {
    const doc = await readAgent()
    const preview = await service.preview(formEdit(doc, 'Reviews pull requests'))
    expect(preview.validation.ok).toBe(true)
    expect(preview.conflicts).toEqual([])
    expect(preview.operations).toHaveLength(1)
    expect(preview.diffs[0]?.unified).toContain('+description: Reviews pull requests')
    expect(preview.diffs[0]?.unified).toContain('-description: Reviews PRs')
  })

  it('applies a form edit, writes the file, and records a backup', async () => {
    const doc = await readAgent()
    const result = await service.apply(formEdit(doc, 'Reviews pull requests'))
    expect(result.document.description).toBe('Reviews pull requests')
    expect(readFileSync(agentPath, 'utf8')).toContain('description: Reviews pull requests')
    expect(backups.list()).toHaveLength(1)
    expect(backups.list()[0]?.operation).toBe('update')
  })

  it('rejects a stale-base apply with a conflict', async () => {
    const doc = await readAgent()
    writeFileSync(agentPath, '---\nname: reviewer\ndescription: Changed outside\n---\nX\n')
    await expect(service.apply(formEdit(doc, 'Mine'))).rejects.toMatchObject({ code: 'conflict' })
  })

  it('surfaces stale fingerprints as preview conflicts', async () => {
    const doc = await readAgent()
    writeFileSync(agentPath, '---\nname: reviewer\ndescription: Changed outside\n---\nX\n')
    const preview = await service.preview(formEdit(doc, 'Mine'))
    expect(preview.conflicts).toEqual([agentPath])
  })

  it('blocks apply on validation errors and reports them via validate', async () => {
    const doc = await readAgent()
    const badSource: ResourceEdit = {
      resourceId: doc.id,
      base: doc.fingerprints,
      edit: { mode: 'source', raw: '---\nname: [broken\n---\nX\n' }
    }
    const validation = await service.validate(badSource)
    expect(validation.ok).toBe(false)
    await expect(service.apply(badSource)).rejects.toMatchObject({ code: 'invalid-request' })
    expect(readFileSync(agentPath, 'utf8')).toContain('Reviews PRs') // untouched
  })

  it('restores a backup, snapshotting current state first', async () => {
    const original = readFileSync(agentPath, 'utf8')
    const doc = await readAgent()
    const applied = await service.apply(formEdit(doc, 'Reviews pull requests'))
    const restored = await service.restore(applied.backupId)
    expect(readFileSync(agentPath, 'utf8')).toBe(original)
    expect(restored.document?.description).toBe('Reviews PRs')
    expect(restored.backupId).not.toBe(applied.backupId)
    const entries = backups.list()
    expect(entries).toHaveLength(2)
    expect(entries[0]?.operation).toBe('restore')
  })

  it('turns planning failures into validation errors instead of throwing', async () => {
    const doc = await readAgent()
    const badFields: ResourceEdit = {
      resourceId: doc.id,
      base: doc.fingerprints,
      edit: { mode: 'form', fields: { name: 42 } }
    }
    const validation = await service.validate(badFields)
    expect(validation.ok).toBe(false)
    expect(validation.diagnostics[0]?.message).toContain('name must be a string')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `ResourceService` lacks the new constructor arguments and methods.

- [ ] **Step 4: Extend `src/main/services/resources.ts`**

Replace the file with:

```ts
import { createPatch } from 'diff'
import type {
  ChangePreview,
  DiscoveryContext,
  FileDiff,
  FileOperationPlan,
  NativeResource,
  ProviderId,
  ResourceChange,
  ResourceDocument,
  ResourceEdit,
  ValidationResult
} from '../../shared/resource'
import { AppOperationError } from '../errors'
import type { ProviderRegistry } from '../providers/registry'
import type { ProviderAdapter } from '../providers/types'
import { decodeResourceId, type ResourceRef } from '../providers/shared/resource-id'
import { readTextFile } from '../providers/shared/scan'
import { sha256Hex } from '../hash'
import type { BackupService } from './backups'
import type { ProjectsStore } from './projects-store'
import type { TransactionService } from './transactions'

export interface ResourceQuery {
  providerId?: ProviderId
  kind?: string
  scope?: 'user' | 'project'
  projectId?: string
}

export type ResourceSummary = Omit<ResourceDocument, 'fields' | 'native' | 'fingerprints'>

function matches(native: NativeResource, query: ResourceQuery): boolean {
  if (query.kind !== undefined && native.kind !== query.kind) return false
  if (query.scope !== undefined && native.scope !== query.scope) return false
  if (query.projectId !== undefined && native.projectId !== query.projectId) return false
  return true
}

function toSummary(doc: ResourceDocument): ResourceSummary {
  const { fields: _fields, native: _native, fingerprints: _fingerprints, ...summary } = doc
  return summary
}

interface Resolved {
  adapter: ProviderAdapter
  native: NativeResource
  ref: ResourceRef
}

/**
 * Scan-on-demand resource access. Reads and writes only touch resources that
 * discovery actually finds, so forged ids can never reach paths outside the
 * approved roots; writes additionally pass the TransactionService allow-list.
 */
export class ResourceService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly projects: ProjectsStore,
    private readonly transactions: TransactionService,
    private readonly backups: BackupService
  ) {}

  private context(): DiscoveryContext {
    return {
      projects: this.projects.list().map((project) => ({
        id: project.id,
        path: project.path
      }))
    }
  }

  private async resolve(id: string): Promise<Resolved> {
    const ref = decodeResourceId(id)
    const adapter = this.registry.get(ref.provider)
    const natives = await adapter.discover(this.context())
    const match = natives.find(
      (native) =>
        native.kind === ref.kind &&
        native.scope === ref.scope &&
        native.projectId === ref.projectId &&
        native.paths[0] === ref.path &&
        native.entryKey === ref.entryKey
    )
    if (!match) {
      throw new AppOperationError(
        'not-found',
        'resources:read',
        `Resource no longer exists: ${ref.path}`,
        { path: ref.path }
      )
    }
    return { adapter, native: match, ref }
  }

  async list(query: ResourceQuery): Promise<ResourceSummary[]> {
    const adapters = this.registry
      .all()
      .filter((adapter) => query.providerId === undefined || adapter.id === query.providerId)
    const summaries: ResourceSummary[] = []
    for (const adapter of adapters) {
      const natives = (await adapter.discover(this.context())).filter((native) =>
        matches(native, query)
      )
      for (const native of natives) {
        summaries.push(toSummary(await adapter.parse(native)))
      }
    }
    return summaries
  }

  async read(id: string): Promise<ResourceDocument> {
    const { adapter, native } = await this.resolve(id)
    return adapter.parse(native)
  }

  private buildChange(edit: ResourceEdit, ref: ResourceRef, native: NativeResource): ResourceChange {
    return {
      kind: 'update',
      resourceId: edit.resourceId,
      draft: {
        provider: ref.provider,
        kind: ref.kind,
        scope: ref.scope,
        projectId: ref.projectId,
        entryKey: ref.entryKey,
        sourcePath: native.paths[0],
        fields: edit.edit.mode === 'form' ? edit.edit.fields : {},
        body: edit.edit.mode === 'form' ? edit.edit.body : undefined,
        raw: edit.edit.mode === 'source' ? edit.edit.raw : undefined
      }
    }
  }

  private async planAndValidate(edit: ResourceEdit): Promise<
    Resolved & { plan: FileOperationPlan | null; validation: ValidationResult }
  > {
    const resolved = await this.resolve(edit.resourceId)
    const change = this.buildChange(edit, resolved.ref, resolved.native)
    let plan: FileOperationPlan
    try {
      plan = await resolved.adapter.plan(change)
    } catch (error) {
      // Bad field shapes / malformed sources become validation errors the UI
      // can show inline; infrastructure errors keep propagating.
      if (
        error instanceof AppOperationError &&
        (error.code === 'invalid-request' || error.code === 'not-found')
      ) {
        return {
          ...resolved,
          plan: null,
          validation: {
            ok: false,
            diagnostics: [{ severity: 'error', message: error.message }]
          }
        }
      }
      throw error
    }
    const validation = await resolved.adapter.validate({
      ...change.draft!,
      raw: plan.operations[0]?.content
    })
    return { ...resolved, plan, validation }
  }

  async validate(edit: ResourceEdit): Promise<ValidationResult> {
    return (await this.planAndValidate(edit)).validation
  }

  async preview(edit: ResourceEdit): Promise<ChangePreview> {
    const { plan, validation } = await this.planAndValidate(edit)
    const operations = plan?.operations ?? []
    const diffs: FileDiff[] = operations
      .filter((operation) => operation.kind === 'write')
      .map((operation) => {
        const before = readTextFile(operation.path) ?? ''
        const after = operation.content ?? ''
        return {
          path: operation.path,
          unified: before === after ? '' : createPatch(operation.path, before, after)
        }
      })
    const conflicts = operations
      .map((operation) => operation.path)
      .filter((path) => {
        const current = readTextFile(path)
        const currentHash = current === null ? '' : sha256Hex(current)
        const baseEntry = edit.base.find((entry) => entry.path === path)
        return baseEntry === undefined || baseEntry.hash !== currentHash
      })
    return { operations, diffs, validation, conflicts }
  }

  async apply(edit: ResourceEdit): Promise<{ document: ResourceDocument; backupId: string }> {
    const { plan, validation, adapter, native, ref } = await this.planAndValidate(edit)
    if (plan === null || !validation.ok) {
      const firstError = validation.diagnostics.find((d) => d.severity === 'error')
      throw new AppOperationError(
        'invalid-request',
        'resources:apply',
        `Validation failed: ${firstError?.message ?? 'unknown error'}`
      )
    }
    const doc = await adapter.parse(native)
    const { backupId } = this.transactions.apply(
      { resourceId: edit.resourceId, resourceName: doc.name, provider: ref.provider, kind: ref.kind },
      plan.operations,
      { base: edit.base, operation: 'update' }
    )
    return { document: await this.read(edit.resourceId), backupId }
  }

  async restore(backupId: string): Promise<{ document: ResourceDocument | null; backupId: string }> {
    const backup = this.backups.get(backupId)
    const operations = backup.files.map((file) =>
      file.content === null
        ? ({ kind: 'delete', path: file.path } as const)
        : ({ kind: 'write', path: file.path, content: file.content } as const)
    )
    // Restore is an explicit overwrite: no conflict check, but the current
    // state is snapshotted first so the restore itself is undoable.
    const { backupId: preRestoreId } = this.transactions.apply(
      backup.target,
      [...operations],
      { operation: 'restore' }
    )
    let document: ResourceDocument | null = null
    try {
      document = await this.read(backup.target.resourceId)
    } catch {
      document = null
    }
    return { document, backupId: preRestoreId }
  }
}
```

- [ ] **Step 5: Register the handlers in `src/main/ipc/handlers.ts`**

Add `backups: BackupService` to `HandlerDeps` (import the type) and append to `registerIpcHandlers`:

```ts
  handle('resources:validate', (request) => deps.resources.validate(request))
  handle('resources:preview', (request) => deps.resources.preview(request))
  handle('resources:apply', (request) => deps.resources.apply(request))
  handle('resources:restore', (request) => deps.resources.restore(request.backupId))
  handle('backups:list', (request) => deps.backups.list(request.resourceId))
```

- [ ] **Step 6: Wire the services in `src/main/index.ts`**

In the `app.whenReady()` block (add `homedir` to the `node:os` import or add the import):

```ts
  const backups = new BackupService(db, join(app.getPath('userData'), 'backups'))
  const transactions = new TransactionService(
    {
      roots: () => [
        join(homedir(), '.codex'),
        join(homedir(), '.claude'),
        ...projects.list().map((project) => project.path)
      ],
      files: () => [join(homedir(), '.claude.json')]
    },
    backups
  )
  const resources = new ResourceService(registry, projects, transactions, backups)
```

(keeping the existing `db`, `registry`, `projects` lines; update the `registerIpcHandlers({ ... })` call to pass `backups`). The roots mirror the adapter defaults; project paths are read at call time so newly added projects are immediately writable.

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock src/main/services/resources.ts src/main/services/resources.test.ts src/main/ipc/handlers.ts src/main/index.ts
git commit -m "feat: resource service validate/preview/apply/restore with ipc wiring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note: `src/main/index.ts` also contains uncommitted app-icon lines from before this milestone; committing them together with this wiring is acceptable, or `git add -p` them out — implementer's choice, mention it in the commit if included.

---

### Task 12: Renderer editor foundation — CodeMirror, editor model, diff view

**Files:**

- Modify: `package.json` (CodeMirror dev dependencies)
- Create: `src/renderer/src/lib/editor-model.ts`
- Create: `src/renderer/src/lib/editor-model.test.ts`
- Create: `src/renderer/src/components/editor/SourceEditor.tsx`
- Create: `src/renderer/src/components/editor/DiffView.tsx`
- Create: `src/renderer/src/components/ui/textarea.tsx`

**Interfaces:**

- Consumes: `ResourceDocument` from `@shared/resource`.
- Produces: `editor-model.ts`: `TextFieldSpec { key: string; label: string; multiline: boolean }`, `splitBody(raw: string): string`, `formFieldSpecs(doc): TextFieldSpec[]`, `supportsSourceEdit(doc): boolean`, `hasBodyEditor(doc): boolean`, `initialFieldValues(doc, specs): Record<string, string>`, `initialArgs(doc): string` (newline-joined), `initialEnv(doc): Array<{ key: string; value: string }>`. `SourceEditor` props `{ value: string; format: ResourceDocument['native']['format']; onChange(next: string): void }` (uncontrolled after mount — parent remounts via `key` when the document changes). `DiffView` props `{ unified: string }`. `Textarea` — shadcn-style styled `<textarea>`. Consumed by Task 13.

- [ ] **Step 1: Add CodeMirror dev dependencies**

Run: `bun add -d codemirror @codemirror/lang-markdown @codemirror/lang-json @codemirror/state @codemirror/view`
Expected: packages land in `devDependencies` (renderer code is bundled by Vite; the existing React deps follow the same convention).

- [ ] **Step 2: Write the failing tests `src/renderer/src/lib/editor-model.test.ts`**

Model this file's imports on the existing `src/renderer/src/lib/mask.test.ts` (same vitest setup covers `src/renderer`).

```ts
import { describe, expect, it } from 'vitest'
import type { ResourceDocument } from '@shared/resource'
import {
  formFieldSpecs,
  hasBodyEditor,
  initialArgs,
  initialEnv,
  initialFieldValues,
  splitBody,
  supportsSourceEdit
} from './editor-model'

function doc(overrides: Partial<ResourceDocument>): ResourceDocument {
  return {
    id: 'id',
    provider: 'claude',
    kind: 'agents',
    name: 'x',
    scope: 'user',
    enabled: 'unsupported',
    sourcePaths: ['/f.md'],
    fingerprints: [{ path: '/f.md', hash: 'h' }],
    fields: {},
    native: { format: 'markdown', raw: '' },
    diagnostics: [],
    modifiedAt: '2026-07-08T00:00:00.000Z',
    ...overrides
  }
}

describe('splitBody', () => {
  it('returns everything after the frontmatter block', () => {
    expect(splitBody('---\nname: a\n---\n\nBody\n')).toBe('\nBody\n')
    expect(splitBody('No frontmatter\n')).toBe('No frontmatter\n')
  })
})

describe('formFieldSpecs', () => {
  it('varies by provider and kind', () => {
    expect(formFieldSpecs(doc({})).map((spec) => spec.key)).toEqual(['name', 'description'])
    expect(
      formFieldSpecs(doc({ provider: 'codex', kind: 'agents' })).map((spec) => spec.key)
    ).toEqual(['name', 'description', 'developer_instructions'])
    expect(formFieldSpecs(doc({ kind: 'commands' })).map((spec) => spec.key)).toEqual([
      'description'
    ])
    expect(formFieldSpecs(doc({ kind: 'instructions' }))).toEqual([])
    expect(formFieldSpecs(doc({ kind: 'mcp-servers' }))).toEqual([])
  })
})

describe('capability flags', () => {
  it('mcp entries are form-only; codex agents have no body editor', () => {
    expect(supportsSourceEdit(doc({}))).toBe(true)
    expect(supportsSourceEdit(doc({ kind: 'mcp-servers' }))).toBe(false)
    expect(hasBodyEditor(doc({}))).toBe(true)
    expect(hasBodyEditor(doc({ provider: 'codex', kind: 'agents' }))).toBe(false)
    expect(hasBodyEditor(doc({ kind: 'mcp-servers' }))).toBe(false)
  })
})

describe('initial values', () => {
  it('extracts strings, args, and env rows defensively', () => {
    const mcp = doc({
      kind: 'mcp-servers',
      fields: { command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } }
    })
    expect(initialFieldValues(doc({ fields: { name: 'n', description: 3 } }), formFieldSpecs(doc({})))).toEqual({
      name: 'n',
      description: ''
    })
    expect(initialArgs(mcp)).toBe('-y\npkg')
    expect(initialArgs(doc({ kind: 'mcp-servers' }))).toBe('')
    expect(initialEnv(mcp)).toEqual([{ key: 'A', value: '1' }])
    expect(initialEnv(doc({ kind: 'mcp-servers' }))).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./editor-model`.

- [ ] **Step 4: Implement `src/renderer/src/lib/editor-model.ts`**

```ts
import type { ResourceDocument } from '@shared/resource'

export interface TextFieldSpec {
  key: string
  label: string
  multiline: boolean
}

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/

/** The Markdown body after the frontmatter block (mirrors the main-process split). */
export function splitBody(raw: string): string {
  const match = FRONTMATTER.exec(raw)
  return match ? raw.slice(match[0].length) : raw
}

/** MCP entries live inside shared files: form-only in Milestone 3. */
export function supportsSourceEdit(doc: ResourceDocument): boolean {
  return doc.kind !== 'mcp-servers' && doc.native.raw !== undefined
}

export function hasBodyEditor(doc: ResourceDocument): boolean {
  if (doc.kind === 'mcp-servers') return false
  return !(doc.provider === 'codex' && doc.kind === 'agents')
}

export function formFieldSpecs(doc: ResourceDocument): TextFieldSpec[] {
  if (doc.kind === 'mcp-servers' || doc.kind === 'instructions') return []
  if (doc.provider === 'codex' && doc.kind === 'agents') {
    return [
      { key: 'name', label: 'Name', multiline: false },
      { key: 'description', label: 'Description', multiline: true },
      { key: 'developer_instructions', label: 'Developer instructions', multiline: true }
    ]
  }
  if (doc.kind === 'commands') {
    return [{ key: 'description', label: 'Description', multiline: true }]
  }
  return [
    { key: 'name', label: 'Name', multiline: false },
    { key: 'description', label: 'Description', multiline: true }
  ]
}

export function initialFieldValues(
  doc: ResourceDocument,
  specs: TextFieldSpec[]
): Record<string, string> {
  return Object.fromEntries(
    specs.map((spec) => {
      const value = doc.fields[spec.key]
      return [spec.key, typeof value === 'string' ? value : '']
    })
  )
}

export function initialArgs(doc: ResourceDocument): string {
  const args = doc.fields['args']
  if (!Array.isArray(args)) return ''
  return args.filter((arg): arg is string => typeof arg === 'string').join('\n')
}

export function initialEnv(doc: ResourceDocument): Array<{ key: string; value: string }> {
  const env = doc.fields['env']
  if (env === null || typeof env !== 'object' || Array.isArray(env)) return []
  return Object.entries(env)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => ({ key, value }))
}
```

- [ ] **Step 5: Implement `src/renderer/src/components/editor/SourceEditor.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'
import type { ResourceDocument } from '@shared/resource'

interface SourceEditorProps {
  /** Initial content. The editor owns the text after mount — remount via key to reset. */
  value: string
  format: ResourceDocument['native']['format']
  onChange(next: string): void
}

function language(format: SourceEditorProps['format']): Extension[] {
  if (format === 'markdown') return [markdown()]
  if (format === 'json') return [json()]
  return []
}

export function SourceEditor({ value, format, onChange }: SourceEditorProps) {
  const container = useRef<HTMLDivElement>(null)
  const latestOnChange = useRef(onChange)
  latestOnChange.current = onChange

  useEffect(() => {
    if (!container.current) return
    const view = new EditorView({
      doc: value,
      parent: container.current,
      extensions: [
        basicSetup,
        ...language(format),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latestOnChange.current(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { fontSize: '12px', backgroundColor: 'transparent' },
          '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
          '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
          '&.cm-focused': { outline: 'none' }
        })
      ]
    })
    return () => view.destroy()
    // Mount-only by design: `value` seeds the document, the editor owns it after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format])

  return (
    <div
      ref={container}
      className="max-h-96 min-h-40 overflow-auto rounded-lg border border-border bg-muted/30"
    />
  )
}
```

- [ ] **Step 6: Implement `src/renderer/src/components/editor/DiffView.tsx`**

```tsx
import { cn } from '../../lib/utils'

interface DiffViewProps {
  unified: string
}

/** Renders a unified diff with line coloring; hides the jsdiff header lines. */
export function DiffView({ unified }: DiffViewProps) {
  const lines = unified.split('\n')
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'))
  const visible = firstHunk === -1 ? lines : lines.slice(firstHunk)
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
      {visible.map((line, index) => (
        <div
          key={index}
          className={cn(
            line.startsWith('+') && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
            line.startsWith('-') && 'bg-red-500/15 text-red-700 dark:text-red-400',
            line.startsWith('@@') && 'text-muted-foreground'
          )}
        >
          {line === '' ? ' ' : line}
        </div>
      ))}
    </pre>
  )
}
```

- [ ] **Step 7: Implement `src/renderer/src/components/ui/textarea.tsx`**

Match the existing `input.tsx` conventions (open it and mirror its class names/structure):

```tsx
import * as React from 'react'
import { cn } from '../../lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-[12px] shadow-xs transition-[color,box-shadow] outline-none',
        'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

- [ ] **Step 8: Run tests and typecheck**

Run: `bun run test`
Expected: PASS (editor-model suite green).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock src/renderer/src/lib/editor-model.ts src/renderer/src/lib/editor-model.test.ts src/renderer/src/components/editor src/renderer/src/components/ui/textarea.tsx
git commit -m "feat: renderer editor foundation with codemirror and diff view

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: ResourceEditor, PreviewDialog, and inspector integration

**Files:**

- Create: `src/renderer/src/components/editor/PreviewDialog.tsx`
- Create: `src/renderer/src/components/editor/ResourceEditor.tsx`
- Modify: `src/renderer/src/components/ResourceInspector.tsx`
- Modify: `src/renderer/src/screens/ResourceListScreen.tsx`

**Interfaces:**

- Consumes: Task 12's `SourceEditor`, `DiffView`, `Textarea`, editor-model helpers; Task 4's DesktopApi (`resources.preview/apply` return `IpcEnvelope`).
- Produces: `PreviewDialog` props `{ preview: ChangePreview; busy: boolean; onConfirm(): void; onClose(): void }`; `ResourceEditor` props `{ doc: ResourceDocument; onCancel(): void; onSaved(fresh: ResourceDocument): void; onReload(): void }`; `ResourceInspector` gains optional prop `onChanged?: () => void` and an internal edit mode. No renderer unit tests (project convention: only pure `lib/` code is unit-tested); verification is typecheck + Task 15.

- [ ] **Step 1: Implement `src/renderer/src/components/editor/PreviewDialog.tsx`**

```tsx
import { useState } from 'react'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import type { ChangePreview } from '@shared/resource'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { DiffView } from './DiffView'

interface PreviewDialogProps {
  preview: ChangePreview
  busy: boolean
  onConfirm(): void
  onClose(): void
}

export function PreviewDialog({ preview, busy, onConfirm, onClose }: PreviewDialogProps) {
  const [warningsConfirmed, setWarningsConfirmed] = useState(false)
  const errors = preview.validation.diagnostics.filter((d) => d.severity === 'error')
  const warnings = preview.validation.diagnostics.filter((d) => d.severity === 'warning')
  const hasChanges = preview.diffs.some((diff) => diff.unified !== '')
  const blocked =
    busy ||
    errors.length > 0 ||
    preview.conflicts.length > 0 ||
    !hasChanges ||
    (warnings.length > 0 && !warningsConfirmed)

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[min(85vh,52rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review changes</DialogTitle>
          <DialogDescription>
            A backup of every affected file is created before anything is written.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          {preview.conflicts.length > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px]">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <span>
                Changed outside Agent Control since you loaded it:{' '}
                {preview.conflicts.join(', ')}. Close this dialog and reload before applying.
              </span>
            </div>
          ) : null}

          {preview.validation.diagnostics.length > 0 ? (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Validation
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {preview.validation.diagnostics.map((diagnostic, index) => (
                  <li key={index} className="flex items-start gap-2 text-[12px]">
                    {diagnostic.severity === 'error' ? (
                      <OctagonAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    ) : diagnostic.severity === 'warning' ? (
                      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                    ) : (
                      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span>
                      <span className="sr-only">{diagnostic.severity}: </span>
                      {diagnostic.message}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {preview.diffs.map((diff) => (
            <section key={diff.path}>
              <code className="font-mono text-[11px] text-muted-foreground">{diff.path}</code>
              {diff.unified === '' ? (
                <p className="mt-1 text-[12px] text-muted-foreground">No changes.</p>
              ) : (
                <div className="mt-1">
                  <DiffView unified={diff.unified} />
                </div>
              )}
            </section>
          ))}
          {!hasChanges ? (
            <p className="text-[12px] text-muted-foreground">Nothing to apply — the edit produces identical content.</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          {warnings.length > 0 ? (
            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={warningsConfirmed}
                onChange={(event) => setWarningsConfirmed(event.target.checked)}
              />
              Apply despite warnings
            </label>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={onConfirm} disabled={blocked}>
              {busy ? 'Applying…' : 'Apply changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Implement `src/renderer/src/components/editor/ResourceEditor.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { AlertTriangle, Plus, X } from 'lucide-react'
import type { AppError } from '@shared/ipc'
import type { ChangePreview, ResourceDocument, ResourceEdit, ResourceEditPayload } from '@shared/resource'
import {
  formFieldSpecs,
  hasBodyEditor,
  initialArgs,
  initialEnv,
  initialFieldValues,
  splitBody,
  supportsSourceEdit
} from '../../lib/editor-model'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { PreviewDialog } from './PreviewDialog'
import { SourceEditor } from './SourceEditor'

interface ResourceEditorProps {
  doc: ResourceDocument
  onCancel(): void
  onSaved(fresh: ResourceDocument): void
  /** Re-read the document after an external change (drops current edits). */
  onReload(): void
}

type EditorTab = 'form' | 'source'

interface EnvRow {
  key: string
  value: string
}

export function ResourceEditor({ doc, onCancel, onSaved, onReload }: ResourceEditorProps) {
  const specs = useMemo(() => formFieldSpecs(doc), [doc])
  const isMcp = doc.kind === 'mcp-servers'
  const sourceEditable = supportsSourceEdit(doc)
  const bodyEditable = hasBodyEditor(doc)

  const [tab, setTab] = useState<EditorTab>('form')
  const [fields, setFields] = useState(() => initialFieldValues(doc, specs))
  const [body, setBody] = useState(() => splitBody(doc.native.raw ?? ''))
  const [command, setCommand] = useState(() =>
    typeof doc.fields['command'] === 'string' ? doc.fields['command'] : ''
  )
  const [argsText, setArgsText] = useState(() => initialArgs(doc))
  const [envRows, setEnvRows] = useState<EnvRow[]>(() => initialEnv(doc))
  const [source, setSource] = useState(doc.native.raw ?? '')
  const [preview, setPreview] = useState<ChangePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<AppError | null>(null)

  const buildEdit = (): ResourceEdit => {
    let payload: ResourceEditPayload
    if (tab === 'source' && sourceEditable) {
      payload = { mode: 'source', raw: source }
    } else if (isMcp) {
      payload = {
        mode: 'form',
        fields: {
          command,
          args: argsText
            .split('\n')
            .map((arg) => arg.trim())
            .filter((arg) => arg !== ''),
          env: Object.fromEntries(
            envRows
              .filter((row) => row.key.trim() !== '')
              .map((row) => [row.key.trim(), row.value])
          )
        }
      }
    } else {
      payload = {
        mode: 'form',
        fields: { ...fields },
        body: bodyEditable ? body : undefined
      }
    }
    return { resourceId: doc.id, base: doc.fingerprints, edit: payload }
  }

  const requestPreview = async () => {
    setBusy(true)
    setFailure(null)
    const envelope = await window.desktopApi.resources.preview(buildEdit())
    setBusy(false)
    if (!envelope.ok) {
      setFailure(envelope.error)
      return
    }
    setPreview(envelope.data)
  }

  const confirmApply = async () => {
    setBusy(true)
    setFailure(null)
    const envelope = await window.desktopApi.resources.apply(buildEdit())
    setBusy(false)
    setPreview(null)
    if (!envelope.ok) {
      setFailure(envelope.error)
      return
    }
    onSaved(envelope.data.document)
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      {sourceEditable ? (
        <div className="flex gap-1 self-start rounded-lg border border-border p-0.5">
          {(['form', 'source'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setTab(candidate)}
              className={cn(
                'rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
                tab === candidate ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {candidate === 'form' ? 'Form' : 'Source'}
            </button>
          ))}
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px]"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            <span>
              {failure.code === 'conflict'
                ? 'This file changed outside Agent Control since you loaded it.'
                : failure.message}
              {failure.recovery ? ` ${failure.recovery}` : ''}
            </span>
          </span>
          {failure.code === 'conflict' ? (
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onReload}>
                Reload latest (drops your edits)
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFailure(null)}>
                Keep editing
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}

      {tab === 'source' && sourceEditable ? (
        <SourceEditor value={source} format={doc.native.format} onChange={setSource} />
      ) : isMcp ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="font-medium">Command</span>
            <Input value={command} onChange={(event) => setCommand(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="font-medium">Arguments (one per line)</span>
            <Textarea
              rows={4}
              className="font-mono"
              value={argsText}
              onChange={(event) => setArgsText(event.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1 text-[12px]">
            <span className="font-medium">Environment variables</span>
            {envRows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={`Variable ${index + 1} name`}
                  className="font-mono"
                  value={row.key}
                  onChange={(event) =>
                    setEnvRows(envRows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))
                  }
                />
                <Input
                  aria-label={`Variable ${index + 1} value`}
                  className="font-mono"
                  value={row.value}
                  onChange={(event) =>
                    setEnvRows(envRows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove variable ${index + 1}`}
                  onClick={() => setEnvRows(envRows.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setEnvRows([...envRows, { key: '', value: '' }])}
            >
              <Plus aria-hidden /> Add variable
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {specs.map((spec) => (
            <label key={spec.key} className="flex flex-col gap-1 text-[12px]">
              <span className="font-medium">{spec.label}</span>
              {spec.multiline ? (
                <Textarea
                  rows={3}
                  value={fields[spec.key] ?? ''}
                  onChange={(event) => setFields({ ...fields, [spec.key]: event.target.value })}
                />
              ) : (
                <Input
                  value={fields[spec.key] ?? ''}
                  onChange={(event) => setFields({ ...fields, [spec.key]: event.target.value })}
                />
              )}
            </label>
          ))}
          {bodyEditable ? (
            <label className="flex flex-col gap-1 text-[12px]">
              <span className="font-medium">{doc.kind === 'instructions' ? 'Content' : 'Body'}</span>
              <Textarea
                rows={10}
                className="font-mono"
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
          ) : null}
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={requestPreview} disabled={busy}>
          {busy && !preview ? 'Preparing…' : 'Review & save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      {preview ? (
        <PreviewDialog
          preview={preview}
          busy={busy}
          onConfirm={confirmApply}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Integrate edit mode into `src/renderer/src/components/ResourceInspector.tsx`**

Changes:

1. Add `onChanged?: () => void` to `ResourceInspectorProps`.
2. Extract the document fetch into a reusable callback and add edit state:

```tsx
  const [editing, setEditing] = useState(false)

  const load = useCallback(() => {
    setDoc(null)
    setError(null)
    window.desktopApi.resources
      .read(resourceId)
      .then(setDoc)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [resourceId])

  useEffect(() => {
    setEditing(false)
    load()
  }, [load])
```

(keep the cancelled-flag pattern if preferred; `load` is also called from the editor's reload path.)

3. In the header, next to the badges, add an Edit toggle (import `Pencil` from lucide-react):

```tsx
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setEditing(true)}
            disabled={editing || doc.native.raw === undefined}
          >
            <Pencil aria-hidden /> Edit
          </Button>
```

4. Below the header, render the editor instead of the fields/source sections while editing:

```tsx
      {editing ? (
        <ResourceEditor
          key={`${doc.id}:${doc.modifiedAt}:${doc.fingerprints[0]?.hash ?? ''}`}
          doc={doc}
          onCancel={() => setEditing(false)}
          onSaved={(fresh) => {
            setDoc(fresh)
            setEditing(false)
            onChanged?.()
          }}
          onReload={load}
        />
      ) : (
        <>{/* existing diagnostics / fields / source sections unchanged */}</>
      )}
```

The `key` remounts the editor with fresh state after a reload (the conflict "Reload latest" path).

- [ ] **Step 4: Pass the refresh callback in `src/renderer/src/screens/ResourceListScreen.tsx`**

```tsx
          <ResourceInspector
            resourceId={selected.id}
            kindLabel={kindLabel}
            projectName={projectName(selected.projectId)}
            onChanged={refresh}
          />
```

- [ ] **Step 5: Typecheck and test**

Run: `bun run typecheck`
Expected: exit 0.

Run: `bun run test`
Expected: PASS (no new suites; nothing broken).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/editor src/renderer/src/components/ResourceInspector.tsx src/renderer/src/screens/ResourceListScreen.tsx
git commit -m "feat: inspector edit mode with form/source tabs and change preview

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note: `ResourceListScreen.tsx` also carries the pre-existing uncommitted Select swap; including it in this commit is fine.

---

### Task 14: Backups screen

**Files:**

- Create: `src/renderer/src/screens/BackupsScreen.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: `window.desktopApi.backups.list()`, `window.desktopApi.resources.restore(backupId)` (envelope), `BackupEntry` from `@shared/ipc`; existing `Badge`, `Button`, `Dialog`, `EmptyState`, `ProviderLogo` components.
- Produces: `BackupsScreen` component wired into the existing `backups` nav key (replacing the M2 EmptyState placeholder in `App.tsx`).

- [ ] **Step 1: Implement `src/renderer/src/screens/BackupsScreen.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { BackupEntry } from '@shared/ipc'
import { EmptyState } from '../components/EmptyState'
import { ProviderLogo } from '../components/ProviderLogo'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'

export function BackupsScreen() {
  const [entries, setEntries] = useState<BackupEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BackupEntry | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    setError(null)
    window.desktopApi.backups
      .list()
      .then(setEntries)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(refresh, [refresh])

  const restore = async (entry: BackupEntry) => {
    setBusy(true)
    setNotice(null)
    setError(null)
    const envelope = await window.desktopApi.resources.restore(entry.id)
    setBusy(false)
    setConfirming(null)
    if (!envelope.ok) {
      setError(
        `${envelope.error.message}${envelope.error.recovery ? ` ${envelope.error.recovery}` : ''}`
      )
      return
    }
    setNotice(`Restored ${entry.resourceName}. A pre-restore backup was created.`)
    refresh()
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Backups</h1>
          <p className="text-[12px] text-muted-foreground">
            Agent Control snapshots every file before changing it. Latest 50 per resource are kept.
          </p>
        </div>
        <Button variant="ghost" size="sm" aria-label="Refresh" onClick={refresh}>
          <RefreshCw aria-hidden />
        </Button>
      </header>

      {error ? (
        <p role="alert" className="px-6 py-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="px-6 py-3 text-[13px] text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {entries !== null && entries.length === 0 ? (
        <EmptyState
          title="No backups yet"
          description="Backups appear here the first time you save a change to a resource."
        />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto px-6">
          {(entries ?? []).map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-3">
              <ProviderLogo providerId={entry.provider} className="size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{entry.resourceName}</span>
                  <Badge variant="outline">{entry.kind}</Badge>
                  <Badge variant={entry.operation === 'restore' ? 'secondary' : 'outline'}>
                    {entry.operation}
                  </Badge>
                </div>
                {entry.paths.map((path) => (
                  <code key={path} className="block truncate font-mono text-[11px] text-muted-foreground">
                    {path}
                  </code>
                ))}
                <span className="text-[11px] text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setConfirming(entry)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}

      {confirming ? (
        <Dialog open onOpenChange={(open) => (!open ? setConfirming(null) : undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Restore {confirming.resourceName}?</DialogTitle>
              <DialogDescription>
                The current content of these files will be overwritten (a pre-restore backup is
                created first):
              </DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-1">
              {confirming.paths.map((path) => (
                <li key={path}>
                  <code className="font-mono text-[11px]">{path}</code>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void restore(confirming)} disabled={busy}>
                {busy ? 'Restoring…' : 'Restore'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `src/renderer/src/App.tsx`**

Import `BackupsScreen` and replace the `backups` branch:

```tsx
  if (selected === 'backups') return <BackupsScreen />
```

(the `EmptyState` import stays — other branches still use it).

- [ ] **Step 3: Typecheck and test**

Run: `bun run typecheck`
Expected: exit 0.

Run: `bun run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/screens/BackupsScreen.tsx src/renderer/src/App.tsx
git commit -m "feat: backups screen with restore

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `bun run test`
Expected: PASS, zero failures.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Production build (explicitly authorized for this task only)**

Run: `bun run build`
Expected: exit 0 — main, preload, and renderer bundles build. CodeMirror and `diff` must not produce bundling errors.

- [ ] **Step 4: Milestone acceptance check (from the design spec's "Goal")**

Confirm each item has landed, by inspection of the code and tests:

- Structured form editing for all five kinds, both providers (Tasks 5–8, 13).
- Source editing for standalone files; MCP entries form-only (Tasks 8, 12–13).
- Validation blocks errors at apply time in main; warnings require UI confirmation (Tasks 8, 11, 13).
- Change preview with per-file unified diff (Tasks 11, 13).
- Atomic writes with allow-listed roots and symlink checks (Task 10).
- Conflict detection via fingerprints on preview and apply (Tasks 10–11, 13).
- Backups with 50-per-resource retention and restore, including pre-restore snapshots (Tasks 9, 11, 14).

- [ ] **Step 5: Report**

Summarize: tasks completed, test count, any deviations taken during implementation (and why). Do not push or open a PR — integration is decided by the user afterwards.
