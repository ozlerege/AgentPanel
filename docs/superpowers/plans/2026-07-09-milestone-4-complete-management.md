# Milestone 4: Complete Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Implementer note:** This plan is written for a high-capability implementer (gpt-5.5 via Codex, high reasoning effort) with full repository access. Cross-task contracts (types, schemas, channel names, operation semantics) are specified exactly and MUST be used verbatim; code bodies not spelled out here must follow the existing codebase idioms — study the sibling module and its tests before writing (e.g. `src/main/services/transactions.ts`, `src/main/providers/codex.ts`, `src/main/providers/*/edit.ts` and their `.test.ts` files). TDD per task: write the failing tests first, watch them fail, implement, watch them pass.

**Goal:** Create, duplicate, import, export, enable/disable, and delete for all discovered resource kinds through the existing preview-first backed-up pipeline; chokidar-based file watching with renderer auto-refresh; the Backups screen grows into History with per-entry undo; unsigned macOS packaging via electron-builder.

**Architecture:** The M3 `resources:validate/preview/apply` channels widen from `ResourceEdit` to a discriminated `ResourceMutation` union; adapters' `plan()` dispatches on `ResourceChange.kind` (`create | update | delete | duplicate | set-enabled`); `TransactionService` gains `move` and `rmdir` operations; disable is an app-managed `.disabled` rename discovered as `enabled: false`; undo of any operation is the existing `restore` of that operation's backup.

**Tech Stack:** Existing stack (Electron 43, electron-vite 5, React 19, Zod 4, `node:sqlite`, Vitest 4, bun) plus new: `chokidar` (dependencies — main process, externalized) and `electron-builder` (devDependencies).

**Spec:** `docs/superpowers/specs/2026-07-09-milestone-4-complete-management-design.md`

## Global Constraints

- Never use `any` in TypeScript (user rule). Use precise types or `unknown` + narrowing.
- Package manager is **bun** (`bun add`, `bun run`, `bunx`). Never npm/yarn/pnpm.
- Verification commands are `bun run typecheck` and `bun run test`. Do NOT run `bun run dev`. Do NOT run `bun run build` except in Task 12, where it is explicitly authorized.
- Renderer never receives Node/fs access; no generic `readFile`/`writeFile` across the IPC bridge (parent spec §10.2). Import/export dialogs and file reads happen in the MAIN process only.
- Every write inside managed roots goes through `TransactionService`. Export (Task 7) writes only to user-dialog-chosen destinations outside managed roots and is the single exception.
- Validation errors block apply in the MAIN process. Warnings never block; the UI requires explicit confirmation (existing M3 behavior — keep it working for all new mutation kinds).
- Deleting or disabling must never happen without a backup recorded first (existing TransactionService flow guarantees this — do not bypass it).
- Work on branch `milestone-4`. Commit after every task with the trailer: `Co-Authored-By: gpt-5.5 via Codex <noreply@openai.com>`. Stage files explicitly (`git add <paths>`) — never `git add -A` / `git add .`. Leave unrelated untracked files (`resources/app-icon-v2.png`, `resources/app-icon-v3.png`) alone.
- Existing tests must keep passing in every task. When a widened type breaks an existing test's literal (e.g. the old `ResourceEdit` request shape), update the test to the new contract in the same task — never delete coverage.

---

### Task 1: Shared types, IPC contract, DesktopApi, preload

**Files:**

- Modify: `src/shared/resource.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipc.test.ts` (append + update existing edit-channel tests to the mutation shape)
- Modify: `src/shared/desktop-api.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**

Produces in `src/shared/resource.ts` (exact shapes — used by every later task):

```ts
export interface ResourceCreateDraft {
  provider: ProviderId
  kind: string
  scope: 'user' | 'project'
  projectId?: string
  /** Display name; planners slugify it into a filename / entry key. */
  name: string
  fields: Record<string, unknown>
  body?: string
  /** Full native content (imports); wins over fields/body when present. */
  raw?: string
}

export type ResourceMutation =
  | { action: 'edit'; resourceId: string; base: FileFingerprint[]; edit: ResourceEditPayload }
  | { action: 'create'; draft: ResourceCreateDraft }
  | { action: 'duplicate'; resourceId: string; newName: string }
  | { action: 'delete'; resourceId: string; base: FileFingerprint[] }
  | { action: 'set-enabled'; resourceId: string; enabled: boolean; base: FileFingerprint[] }
```

`FileOperation.kind` gains `'rmdir'` (JSDoc: removes an empty directory only). `ResourceChange` becomes:

```ts
export interface ResourceChange {
  kind: 'create' | 'update' | 'delete' | 'duplicate' | 'set-enabled'
  resourceId?: string
  draft?: ResourceDraft
  newName?: string
  enabled?: boolean
}
```

`ResourceDraft` gains optional `name?: string`. Keep `ResourceEdit` exported (renderer editor-model still builds it; it maps 1:1 onto the `edit` mutation arm).

Produces in `src/shared/ipc.ts`:

- `resourceCreateDraftSchema`, `resourceMutationSchema` (discriminated union on `action`, arms exactly mirroring the type above; reuse `fileFingerprintSchema` and the existing edit-payload union extracted from `resourceEditSchema`).
- `resources:validate/preview/apply` request becomes `resourceMutationSchema`.
- `applyResultSchema` becomes `{ document: resourceDocumentSchema.nullable(), backupId: z.string() }`.
- `backupEntrySchema.operation` widens to `z.enum(['update', 'restore', 'create', 'delete', 'duplicate', 'enable', 'disable'])`. Export `BackupOperation = BackupEntry['operation']`.
- `fileOperationSchema.kind` gains `'rmdir'`.
- `resourceCategorySchema` gains `createScopes: z.array(z.enum(['user', 'project'])).optional()` (categories that support create advertise where).
- New channels in `ipcContract`:
  - `'resources:export'`: request `z.object({ resourceId: z.string() })`, response `z.object({ savedTo: z.string().nullable() })`
  - `'resources:reveal'`: request `z.object({ resourceId: z.string() })`, response `z.undefined()`
  - `'imports:pick'`: request `z.object({ providerId: providerIdSchema, kind: z.string() })`, response `z.object({ fileName: z.string(), raw: z.string() }).nullable()`
- Exported constant `RESOURCES_CHANGED_CHANNEL = 'resources:changed'` (push event, not part of the invoke contract).

Produces in `src/shared/desktop-api.ts` / `src/preload/index.ts`:

```ts
resources: {
  list(query?): Promise<ResourceSummary[]>
  read(id): Promise<ResourceDocument>
  validate(mutation: ResourceMutation): Promise<ValidationResult>
  preview(mutation: ResourceMutation): Promise<IpcEnvelope<ChangePreview>>
  apply(mutation: ResourceMutation): Promise<IpcEnvelope<ApplyResult>>
  restore(backupId: string): Promise<IpcEnvelope<RestoreResult>>
  export(resourceId: string): Promise<{ savedTo: string | null }>
  reveal(resourceId: string): Promise<void>
}
imports: {
  pick(providerId: ProviderId, kind: string): Promise<{ fileName: string; raw: string } | null>
}
events: {
  /** Subscribe to main-process resource change pushes; returns unsubscribe. */
  onResourcesChanged(listener: () => void): () => void
}
```

Preload implements `onResourcesChanged` with `ipcRenderer.on(RESOURCES_CHANGED_CHANNEL, wrapped)` and returns `() => ipcRenderer.removeListener(...)`; no payload is forwarded.

- [ ] **Step 1: Failing tests** — append to `src/shared/ipc.test.ts`: mutation union accepts all five arms (concrete literals for each); rejects unknown `action`; `resources:apply` response allows `document: null`; `backupEntrySchema` accepts `operation: 'delete'` and rejects `'rename'`; `fileOperationSchema` accepts `rmdir`; the three new channels parse their requests/responses; categories accept `createScopes: ['user', 'project']`. Update the existing edit-channel tests to wrap payloads as `{ action: 'edit', ... }`.
- [ ] **Step 2: Run `bun run test`** — expect the new assertions to fail.
- [ ] **Step 3: Implement** the shared types, schemas, contract entries, DesktopApi, and preload wiring exactly as specified above.
- [ ] **Step 4: Fix compile fallout minimally.** `src/main/ipc/handlers.ts` and `src/main/services/resources.ts` will no longer typecheck (they still expect `ResourceEdit`). In THIS task only bridge them: in `ResourceService.validate/preview/apply`, accept `ResourceMutation`, handle `action: 'edit'` by mapping onto the existing paths, and throw `new AppOperationError('not-implemented', 'resources:apply', 'Arrives later in Milestone 4.')` for the other arms. Register the three new handlers with `not-implemented` throws for export/reveal/imports (replaced in Task 7). Renderer: update `editor-model.ts`/callers to submit `{ action: 'edit', ...edit }`.
- [ ] **Step 5: Run `bun run test` and `bun run typecheck`** — all green.
- [ ] **Step 6: Commit** `feat: resource mutation union and m4 ipc surface`.

---

### Task 2: TransactionService — move and rmdir operations

**Files:**

- Modify: `src/main/services/transactions.ts`
- Modify: `src/main/services/transactions.test.ts` (append)
- Modify: `src/main/services/backups.ts` (accept the widened operation union)

**Interfaces:**

- `TransactionOptions.operation` widens to `BackupOperation` (import from `../../shared/ipc`). `BackupService.record` takes the same union.
- `apply()` accepts `move` and `rmdir` operations (drops the M3 "Unsupported file operation" guard for them; `mkdir` remains rejected):
  - **move**: requires `toPath`. Allow-list BOTH `path` and `toPath`. Conflict-check `path` against `base` like writes. Reject with `conflict` if `toPath` already exists (message: `Target already exists: <toPath>`). Snapshot records BOTH paths (`path` → current content, `toPath` → `null`) so restore reverses the rename. Execute with `renameSync`; wrap failures in the existing `io` AppOperationError pattern. `setHashAfter(path, '')` and `setHashAfter(toPath, sha256Hex(content))`.
  - **rmdir**: allow-list the path; execute `rmdirSync(path)` (throws if non-empty — let that surface as `io`); not snapshotted (file deletions preceding it are). Skip silently when the directory does not exist.
- Snapshot collection must handle one path appearing in multiple operations without duplicate backup rows (dedupe by path, first occurrence wins).

- [ ] **Step 1: Failing tests** — in a temp allowed root: move succeeds and target has original content while source is gone; restore of the move's backup puts content back at the source and removes the target; move to an existing target → `conflict`; move with source outside roots → `permission`; move with `toPath` outside roots → `permission`; stale base fingerprint on move → `conflict`; rmdir removes an empty dir, errors (`io`) on a non-empty one, no-ops on a missing one; `record`/`apply` accept `operation: 'disable'`.
- [ ] **Step 2: Run `bun run test`** — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `bun run test` + `bun run typecheck`** — green.
- [ ] **Step 5: Commit** `feat: transactional move and rmdir operations`.

---

### Task 3: Discovery of disabled resources + create helpers

**Files:**

- Create: `src/main/providers/shared/create.ts`, `src/main/providers/shared/create.test.ts`
- Modify: `src/main/providers/shared/scan.ts` + test (disabled-variant discovery helpers as needed)
- Modify: `src/main/providers/claude/agents.ts`, `src/main/providers/claude/commands.ts`, `src/main/providers/codex/agents.ts`, `src/main/providers/shared/skills.ts`, `src/main/providers/shared/document.ts` + their tests
- Modify: `src/shared/resource.ts` (`NativeResource` gains `disabled?: boolean`)

**Interfaces:**

- `NativeResource` gains optional `disabled?: boolean`; `buildDocument` (and the per-kind parsers) set `enabled: false` when `native.disabled === true`, `enabled: true` for file kinds otherwise. MCP servers and instructions keep `'unsupported'`.
- Disabled naming convention (exact): single-file kinds append `.disabled` to the FULL filename (`reviewer.md.disabled`, `reviewer.toml.disabled`); skills rename the manifest to `SKILL.md.disabled` (folder name untouched). Discovery scans both variants; the resource `name` shown for a disabled resource must NOT include the suffix (strip it before deriving names; frontmatter/TOML names still win where they exist today).
- Produces in `create.ts` (consumed by Tasks 4–5):

```ts
/** 'My Reviewer!' -> 'my-reviewer'; throws AppOperationError('invalid-request') when nothing survives. */
export function slugifyName(name: string, operation: string): string
/** Valid MCP entry key: /^[A-Za-z0-9_-]+$/; throws invalid-request otherwise. */
export function assertEntryKey(name: string, operation: string): string
/** Template content for a new resource of the kind. */
export function markdownTemplate(kind: 'agents' | 'skills' | 'commands', name: string, description: string, body: string): string
export function codexAgentTemplate(name: string, description: string, developerInstructions: string): string
```

Markdown templates: frontmatter with `name` + `description` (commands: `description` only), blank line, body (default body when empty: `Describe what this ${singular} does.`). Codex agent template: `name = "…"\ndescription = "…"\ndeveloper_instructions = "…"\n` with proper TOML string escaping (reuse `serializeTomlValue`).

- [ ] **Step 1: Failing tests** — slugify (case, spaces, punctuation, empty-after-strip throws); entry key acceptance/rejection; templates byte-exact; new fixture files `tests/fixtures/discovery/claude-user/agents/off.md.disabled`, `.../commands/off.md.disabled`, `.../skills/off-skill/SKILL.md.disabled`, `tests/fixtures/discovery/codex-user/agents/off.toml.disabled` are discovered with `enabled: false` and clean names (`off`, `off-skill`); active fixtures now assert `enabled: true`.
- [ ] **Step 2: Run `bun run test`** — fail.
- [ ] **Step 3: Implement** helpers + discovery/parsing changes (create the fixture files with plausible minimal content).
- [ ] **Step 4: `bun run test` + `bun run typecheck`** — green.
- [ ] **Step 5: Commit** `feat: disabled-resource discovery and creation helpers`.

---

### Task 4: Codex adapter — create, duplicate, delete, set-enabled plans

**Files:**

- Modify: `src/main/fidelity/toml-edit.ts` + test (new primitives)
- Modify: `src/main/providers/codex/edit.ts` + test (MCP entry create/delete planners)
- Modify: `src/main/providers/codex.ts`; extend `src/main/providers/adapters.test.ts`

**Interfaces:**

- New fidelity primitives (mirror existing style and error classes):
  - `appendTomlTable(source: string, tablePath: Array<string | number>, keyValues: Array<[string, TomlValue]>): string` — appends `[a.b]` + lines at EOF (separated by exactly one blank line when the file is non-empty); throws `TomlTableExistsError` if the table or a same-path key-value already exists.
  - `deleteTomlTable(source: string, tablePath: Array<string | number>): string` — removes the table header line through the end of its body (including its sub-tables, e.g. `[mcp_servers.x.env]`, and their trailing blank line); throws `TomlTableNotFoundError` when absent.
- Codex `capabilities()` categories gain `createScopes`: agents, skills, mcp-servers → `['user']` (codex has no project-scope variants of these); instructions → `['user', 'project']` (per-project `AGENTS.md`).
- `plan()` dispatch (all target paths derived from config root/projects, never from renderer input):
  - **create agents**: `write` to `<root>/agents/<slug>.toml` with `codexAgentTemplate` (or `draft.raw` when present); target-exists → throw `AppOperationError('conflict', …)`.
  - **create skills**: `write` to `<root>/skills/<slug>/SKILL.md` with `markdownTemplate('skills', …)`.
  - **create instructions**: `write` `AGENTS.md` at the scope root only when absent; content = `draft.body ?? draft.raw ?? ''`.
  - **create mcp-servers**: `assertEntryKey`; `appendTomlTable(config, ['mcp_servers', key], entries)` from `mcpFormFields` (command required — else `invalid-request`); write full new `config.toml` content; absent `config.toml` starts from `''`.
  - **delete**: agents/instructions → single `delete`; skills → `delete` for EVERY file under the folder (recursive, enumerated at plan time) + `rmdir` ops for each directory deepest-first; mcp-servers → `write` of config with `deleteTomlTable(['mcp_servers', key])` (also handles the env sub-table).
  - **duplicate**: agents → read raw, `write` to `<slug(newName)>.toml` with the TOML `name` value replaced via `setTomlValue`; skills → copy every file under the folder to the new slug folder (read as utf-8; unreadable file → `invalid-request`), with the new SKILL.md `name` frontmatter set via `applyFrontmatterEdit`; mcp-servers → `appendTomlTable` under the new key with the current entry's values; instructions → `invalid-request`.
  - **set-enabled**: agents → `move` between `x.toml` and `x.toml.disabled`; skills → `move` between `SKILL.md` and `SKILL.md.disabled`; requested state already current → `invalid-request`; mcp-servers/instructions → `invalid-request` (message: `Enable/disable is not supported for this resource kind`).
  - `validate()` for create/duplicate drafts: run the existing per-kind content validators over the planned content.
- [ ] **Step 1: Failing tests** — TOML primitives (append to empty and non-empty source byte-exact; existing-table error; delete table with env sub-table byte-exact; missing table error); adapter plans per operation × kind against a temp fixture root: exact operation lists (paths + content), collision conflicts, duplicate naming, set-enabled move ops both directions, unsupported combinations rejected.
- [ ] **Step 2: `bun run test`** — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `bun run test` + `bun run typecheck`** — green.
- [ ] **Step 5: Commit** `feat: codex adapter full mutation planning`.

---

### Task 5: Claude adapter — create, duplicate, delete, set-enabled plans

**Files:**

- Modify: `src/main/providers/claude/edit.ts` + test (MCP entry create/delete planners)
- Modify: `src/main/providers/claude.ts`; extend `src/main/providers/adapters.test.ts`

**Interfaces:**

- `capabilities()` `createScopes`: agents/skills/commands → `['user', 'project']`, mcp-servers → `['user', 'project']`, instructions → `['user', 'project']`.
- Paths: user agents `~/.claude/agents/<slug>.md`, project agents `<project>/.claude/agents/<slug>.md`; commands likewise under `commands/`; skills under `skills/<slug>/SKILL.md`; instructions `CLAUDE.md`; MCP user scope → `~/.claude.json` `mcpServers.<key>`, project scope → `<project>/.mcp.json` `mcpServers.<key>` (create the file as `{ "mcpServers": { "<key>": { … } } }\n` when absent, via `editJsonValue` on `'{}'` or equivalent — study `claude/edit.ts` for the M3 splice idioms).
- Same dispatch semantics as Task 4 (templates from `markdownTemplate`; MCP delete = `editJsonValue(source, ['mcpServers', key], undefined)`; MCP create rejects an existing key with `conflict`; set-enabled moves for agents/skills/commands; duplicate for agents/commands rewrites the frontmatter `name` — commands have no `name` field, so duplicate is a pure content copy to the new slug).
- [ ] **Step 1: Failing tests** — mirror Task 4's coverage for claude kinds, including project-scope creates resolving under the registered project fixture and `.mcp.json` creation-from-absent.
- [ ] **Step 2: `bun run test`** — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `bun run test` + `bun run typecheck`** — green.
- [ ] **Step 5: Commit** `feat: claude adapter full mutation planning`.

---

### Task 6: ResourceService mutation orchestration

**Files:**

- Modify: `src/main/services/resources.ts` + test
- Modify: `src/main/ipc/handlers.ts` (drop the Task 1 bridging throws for validate/preview/apply)

**Interfaces:**

- `validate/preview/apply(mutation: ResourceMutation)` handle every arm:
  - **edit**: unchanged M3 path.
  - **create**: no resolve; validate `scope`/`projectId` against registered projects (`invalid-request` otherwise); `ResourceChange { kind: 'create', draft }`; base fingerprints for the transaction are `[{ path, hash: '' }]` for every planned write target (file-must-not-exist guard at apply time); backup operation `'create'`.
  - **duplicate**: resolve source id; `ResourceChange { kind: 'duplicate', resourceId, newName }`; base like create (targets must not exist); backup operation `'duplicate'`.
  - **delete**: resolve; conflict-guard with the caller's `base`; backup operation `'delete'`; apply returns `document: null`.
  - **set-enabled**: resolve; caller's `base`; backup operation `'enable'` / `'disable'` by direction; apply returns `document: null` (the id changes with the path — renderer refetches the list).
  - `planAndValidate` also converts planner `conflict` AppOperationErrors into blocking validation diagnostics (severity error) so previews render them instead of throwing.
  - After successful create/duplicate apply, re-discover and return the NEW resource's document (match by planned primary path).
- Preview diffs must render `move` (`unified` shows the rename as `- old path` header → keep it simple: diff entry `{ path, unified: '' }` plus operations list carries the semantics; the renderer displays move/rmdir/delete operations from `operations`, not diffs) and `delete` (unified diff from current content to empty).
- [ ] **Step 1: Failing tests** — temp-root end-to-end per arm: create writes the file and returns its document + a `'create'` backup entry; restore of that backup removes it; delete round trip (delete → restore resurrects byte-identical, including a multi-file skill); disable flips discovery to `enabled: false` and enable restores the original path; duplicate copies with the new name and refuses collisions; create with unknown projectId → `invalid-request`; delete with stale base → `conflict`; preview of a delete lists every affected path in `operations`.
- [ ] **Step 2: `bun run test`** — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `bun run test` + `bun run typecheck`** — green.
- [ ] **Step 5: Commit** `feat: full mutation orchestration in ResourceService`.

---

### Task 7: Export, reveal, and import-pick (main process)

**Files:**

- Create: `src/main/services/exchange.ts` + `src/main/services/exchange.test.ts`
- Modify: `src/main/ipc/handlers.ts`, `src/main/index.ts` (dependency wiring — dialogs injected like `pickDirectory`)

**Interfaces:**

```ts
export interface ExchangeDialogs {
  saveFile(defaultName: string): Promise<string | null>
  pickDirectory(title: string): Promise<string | null>
  pickFile(filters: Array<{ name: string; extensions: string[] }>): Promise<string | null>
}
export class ExchangeService {
  constructor(resources: ResourceService, dialogs: ExchangeDialogs)
  /** Copy the resource's native files to a user-chosen destination. */
  export(resourceId: string): Promise<{ savedTo: string | null }>
  /** Open + read a candidate file for import (utf-8, ≤ 1 MiB). */
  pickImport(providerId: ProviderId, kind: string): Promise<{ fileName: string; raw: string } | null>
}
```

- `export`: resolve via `ResourceService.read` (discovery-guarded). Single-file kinds → `saveFile(basename)` then `cpSync`. Skills → `pickDirectory` then recursive `cpSync` of the folder to `<dest>/<folderName>` (refuse existing target with `conflict`). MCP entries → `invalid-request` (`Export is not supported for MCP server entries yet`). Cancelled dialog → `{ savedTo: null }`.
- `pickImport`: only `agents` and `commands` kinds (`invalid-request` otherwise); filters `.md` for claude/commands, `.toml` for codex agents; enforce ≤ 1 MiB (`invalid-request`), utf-8 read; returns basename + raw. Never returns paths to the renderer beyond the display filename.
- Reveal is a one-liner handler: resolve document, `shell.showItemInFolder(doc.sourcePaths[0])` — wire directly in handlers/index with an injected `reveal(path)` fn so tests don't need electron.
- Replace the Task 1 `not-implemented` handlers for `resources:export`, `resources:reveal`, `imports:pick`.
- [ ] **Step 1: Failing tests** — with fake dialogs over temp dirs: export single file copies bytes; export skill folder copies recursively and refuses an existing destination; cancel → null; MCP export rejected; import returns content, rejects >1 MiB, rejects unsupported kinds.
- [ ] **Step 2: `bun run test`** — fail.
- [ ] **Step 3: Implement + wire.**
- [ ] **Step 4: `bun run test` + `bun run typecheck`** — green.
- [ ] **Step 5: Commit** `feat: export, reveal, and import picking`.

---

### Task 8: Renderer — create and import flow

**Files:**

- Create: `src/renderer/src/components/editor/CreateResourceDialog.tsx`
- Modify: `src/renderer/src/screens/ResourceListScreen.tsx`, `src/renderer/src/lib/editor-model.ts` + test

**Behavior:**

- "Add" button in the list header, enabled when the current category's capabilities advertise `createScopes`. Dialog: scope select (user / each registered project, per `createScopes`), name input, per-kind fields reusing the M3 form field components (agents: description + body/developer_instructions; skills/commands: description + body; MCP: command, args one-per-line, env key=value rows; instructions: body only, name hidden — fixed filename shown instead).
- For agents/commands an "Import file…" button calls `window.api.imports.pick(provider, kind)`; a successful pick fills a read-only "imported content" state — the mutation then carries `raw` and the name field slugs the filename stem (editable).
- Save → `resources:preview({ action: 'create', draft })` → reuse the M3 `PreviewDialog` (it must learn to render non-write operations: list `move`/`delete`/`rmdir` operations as labeled rows; keep diffs for writes) → apply → close, refresh list, select the created resource (match by returned document id).
- Editor-model helpers get unit tests for building `ResourceCreateDraft` from form state (args/env parsing reuses M3 logic).
- [ ] **Step 1: Failing tests** for the editor-model create-draft builders (pure functions only — no component tests in this repo).
- [ ] **Step 2: `bun run test`** — fail.
- [ ] **Step 3: Implement** dialog + list wiring, matching the existing screen/dialog idioms (shadcn components, `IpcEnvelope` error handling with the M3 conflict dialog).
- [ ] **Step 4: `bun run test` + `bun run typecheck`** — green.
- [ ] **Step 5: Commit** `feat: create and import resources from the list screen`.

---

### Task 9: Renderer — duplicate, enable/disable, delete, export, reveal actions

**Files:**

- Create: `src/renderer/src/components/ResourceActions.tsx` (dropdown menu; add the shadcn `dropdown-menu` primitive under `components/ui/` if not present)
- Modify: `src/renderer/src/screens/ResourceListScreen.tsx`, `src/renderer/src/components/ResourceInspector.tsx`

**Behavior:**

- Per-row overflow menu + inspector header actions: Duplicate, Enable/Disable (label reflects current state; hidden when `enabled === 'unsupported'`), Export, Reveal in Finder, Delete (destructive styling, separated).
- Duplicate → small dialog with a name input seeded `"<name> copy"` → preview → apply → refresh + select new.
- Enable/Disable and Delete → `read` the document first (fingerprints for `base`), then preview → confirm dialog: delete confirmation lists every path from `preview.operations` and requires typing nothing but an explicit destructive-styled confirm (parent spec §17: confirm by resource name and scope — show both prominently).
- After a successful delete apply: success dialog (reuse the M3 success dialog pattern) with an **Undo** button that calls `resources.restore(backupId)` and refreshes.
- Export: call `resources.export(id)`; toast/dialog the destination or silently no-op on cancel. Reveal: `resources.reveal(id)`.
- All envelope errors reuse the M3 error/conflict dialog handling.
- [ ] **Step 1–3: Implement** (UI task — no new pure logic; keep any new pure helpers in `editor-model.ts` with tests if they emerge).
- [ ] **Step 4: `bun run test` + `bun run typecheck`** — green.
- [ ] **Step 5: Commit** `feat: resource lifecycle actions in list and inspector`.

---

### Task 10: File watching and auto-refresh

**Files:**

- Create: `src/main/services/watcher.ts` + `src/main/services/watcher.test.ts`
- Modify: `src/main/index.ts` (wiring), `src/main/services/projects-store.ts` (change notification hook), `src/renderer/src/App.tsx` (subscription)
- Run: `bun add chokidar`

**Interfaces:**

```ts
export class WatcherService {
  constructor(options: { debounceMs?: number })  // default 400
  /** Replace the watched path set (idempotent restart). */
  watch(paths: string[]): void
  onChange(listener: () => void): () => void
  async close(): Promise<void>
}
```

- Watch paths: `~/.codex`, `~/.claude`, `~/.claude.json`, and per registered project ONLY `<p>/.claude`, `<p>/CLAUDE.md`, `<p>/AGENTS.md`, `<p>/.mcp.json` (chokidar handles not-yet-existing paths; verify and set `ignoreInitial: true`). Never watch a whole project directory.
- All chokidar events collapse into one trailing-debounced `onChange` firing.
- `ProjectsStore` gains `onDidChange(listener): () => void` fired on add/remove; `index.ts` rebuilds the watch list on it and forwards watcher changes to every window: `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(RESOURCES_CHANGED_CHANNEL))`.
- Renderer: `App.tsx` subscribes once via `window.api.events.onResourcesChanged`; on fire, refetch the resource list; refetch the open inspector document only when the inspector is NOT in edit mode (editing keeps the fingerprint conflict flow authoritative).
- [ ] **Step 1: Failing tests** — real chokidar over temp dirs (generous `vi.waitFor` timeouts): file create fires once after debounce; three rapid writes fire once; `watch()` with a new path set picks up changes at the new path and drops the old; `close()` stops events; projects-store `onDidChange` fires on add/remove.
- [ ] **Step 2: `bun run test`** — fail.
- [ ] **Step 3: Implement + wire.**
- [ ] **Step 4: `bun run test` + `bun run typecheck`** — green.
- [ ] **Step 5: Commit** `feat: file watching with renderer auto-refresh`.

---

### Task 11: History screen with undo

**Files:**

- Modify: `src/renderer/src/screens/BackupsScreen.tsx` (rename export/file to `HistoryScreen.tsx`), `src/renderer/src/navigation.ts` + `App.tsx` (label `History`, key stays `backups`), `src/renderer/src/components/NavSidebar.tsx` only if labels are hard-coded there

**Behavior:**

- Table gains an operation badge column (color-coded like existing status badges: create/duplicate = positive, delete/disable = destructive, update/enable/restore = neutral) and a resource-name filter input (client-side).
- Row action renamed **Undo** (restore semantics unchanged); confirm dialog lists the files that will be overwritten/removed and names the operation being undone (`Undo delete of "code-reviewer"`).
- Empty state copy updated to history phrasing.
- [ ] **Step 1–3: Implement** (UI-only task).
- [ ] **Step 4: `bun run test` + `bun run typecheck`** — green.
- [ ] **Step 5: Commit** `feat: history screen with per-operation undo`.

---

### Task 12: macOS packaging

**Files:**

- Create: `electron-builder.yml`
- Modify: `package.json` (script + devDependency via `bun add -d electron-builder`)
- Modify: `.gitignore` if needed (`dist/`)

**Contents of `electron-builder.yml`:**

```yaml
appId: com.egeozler.agent-control
productName: Agent Control
directories:
  output: dist
files:
  - out/**
  - resources/**
  - package.json
mac:
  target:
    - dmg
    - zip
  category: public.app-category.developer-tools
  icon: resources/app-icon.png
  identity: null
npmRebuild: false
```

- Script: `"package:mac": "electron-vite build && electron-builder --mac"`.
- [ ] **Step 1: Add dependency + config + script.**
- [ ] **Step 2: AUTHORIZED verification run:** `bun run build && bunx electron-builder --mac --dir` (dir target only — fast, no dmg). Expected: `dist/mac-arm64/Agent Control.app` exists. Then `open "dist/mac-arm64/Agent Control.app"` and confirm the process launches (check with `pgrep -f "Agent Control"`, then quit it with `osascript -e 'quit app "Agent Control"'`).
- [ ] **Step 3: `bun run typecheck` + `bun run test`** — still green; ensure `dist/` is ignored by git.
- [ ] **Step 4: Commit** `feat: unsigned macos packaging via electron-builder`.

---

## Self-review notes

- Spec coverage: create/duplicate/import/export/enable-disable/delete → Tasks 1–9; watching + auto refresh → Task 10; history + undo → Task 11; packaging → Task 12. Deferred items are listed in the design spec's out-of-scope section.
- Undo of every operation rides the existing restore path — no new restore machinery anywhere.
- The only writes outside `TransactionService` are Task 7 exports to dialog-chosen destinations (design decision 8).
