# Milestone 3: Safe editing — Design

**Date:** 2026-07-08
**Status:** Approved (pipeline pre-authorized by user)
**Depends on:** Milestone 1 (fidelity primitives, typed IPC, SQLite, app shell), Milestone 2 (discovery, ResourceService, list/inspect UI)

## Goal

Users can edit any discovered resource through a structured form or a source editor, see a validated change preview with a textual diff before anything is written, and every write is atomic, conflict-guarded, and backed up with one-click restore.

## Decisions made during brainstorming

1. **Update-only.** M3 edits existing resources. Create, duplicate, import, export, enable/disable, and delete remain Milestone 4. `plan()` handles only `kind: 'update'`.
2. **Editable kinds:** all five discovered kinds for both providers.
   - Structured forms — Claude agents (name, description, body), Codex agents (name, description, developer_instructions), skills (name, description, body), Claude commands (description, body), MCP servers (command, args, env), instructions (content).
   - Source editing — standalone files only (agents, skills, commands, instructions). MCP server entries are **form-only**; their shared files (`~/.codex/config.toml`, `~/.claude.json`, `<project>/.mcp.json`) keep the read-only source view. Surgical entry edits are exactly what the fidelity primitives exist for; whole-shared-file source editing is deferred.
   - Unknown frontmatter/TOML/JSON fields are never dropped: form edits touch only the modeled fields, via the comment-preserving primitives.
3. **Source editor: CodeMirror 6**, not Monaco. Monaco requires web workers and CSP loosening, which conflicts with the sandboxed renderer and strict CSP from M1. CodeMirror 6 is pure DOM, Vite-bundled, and provides markdown/JSON highlighting (`@codemirror/lang-markdown`, `@codemirror/lang-json`); TOML is display-only in M3 (shared files are read-only) so no TOML mode is needed.
4. **Conflict detection: content fingerprints.** `resources:read` returns a sha256 hash per source file; edits echo the fingerprints back; `apply` re-hashes and rejects on mismatch with a `conflict` AppError. No file watching in M3 (M4).
5. **Backups in userData + SQLite metadata.** Every file a change modifies is snapshotted before the write. Retention: latest 50 backups per resource (parent spec §22). A minimal Backups screen lists them and offers restore; restore snapshots the current state first, so restore is itself undoable.
6. **Diffs computed in the main process** with the `diff` package (jsdiff) as per-file unified diffs; the renderer renders them with simple line coloring.

## 1. Shared model and IPC

`src/shared/resource.ts` additions:

```ts
export interface FileFingerprint {
  path: string
  hash: string // sha256 hex of file content; '' for a missing file
}

export type ResourceEditPayload =
  | { mode: 'form'; fields: Record<string, unknown>; body?: string }
  | { mode: 'source'; raw: string }

export interface ResourceEdit {
  resourceId: string
  base: FileFingerprint[] // fingerprints from the read that seeded the editor
  edit: ResourceEditPayload
}

export interface FileDiff {
  path: string
  unified: string // empty when the file is unchanged
}

export interface ChangePreview {
  operations: FileOperation[]
  diffs: FileDiff[]
  validation: ValidationResult
  conflicts: string[] // paths whose current hash no longer matches base
}
```

`ResourceDocument` gains `fingerprints: FileFingerprint[]` (also in the Zod mirror). `ResourceDraft`/`ResourceChange` stay for the adapter contract; the service maps `ResourceEdit` onto them (`ResourceChange.kind: 'update'`).

New IPC channels (existing envelope/validation pattern):

- `resources:validate` — `{ edit: ResourceEdit }` → `ValidationResult`
- `resources:preview` — `{ edit: ResourceEdit }` → `ChangePreview`
- `resources:apply` — `{ edit: ResourceEdit }` → `{ document: ResourceDocument; backupId: string }`
- `resources:restore` — `{ backupId: string }` → `{ document: ResourceDocument | null; backupId: string }` (document null when the resource no longer parses/discovers)
- `backups:list` — `{ resourceId?: string }` → `BackupEntry[]` where `BackupEntry = { id, resourceId, resourceName, provider, kind, paths, operation: 'update' | 'restore', createdAt }`

`DesktopApi` gains `resources.validate/preview/apply/restore` (matching parent spec §10.2) and `backups.list`. Still no generic filesystem methods.

## 2. Fidelity primitive extensions

- `src/main/fidelity/toml-edit.ts` — add `setTomlValue(source, tablePath, key, value)`: replaces the existing value span (current `editTomlValue` mechanism) or, when the key is absent, inserts `key = <serialized>` at the end of the addressed table. Add `deleteTomlKey(source, tablePath, key)`: removes the key-value line (needed when a form edit deletes an MCP `env` entry). Add `serializeTomlValue` for `string | number | boolean | string[] | Record<string, string>` (inline table) with proper escaping. When per-key addressing inside `env` is not possible (inline-table env), the planner replaces the whole `env` value with a serialized inline table — still byte-identical outside the replaced span. MCP entry deletions in JSON use `editJsonValue` with `undefined` (jsonc-parser removes the key).
- `src/main/fidelity/agent-markdown.ts` — generalize to `applyFrontmatterEdit(source, fields: Record<string, string>, body?: string)`: sets only changed frontmatter keys through the YAML `Document` API (comments and unknown fields survive) and optionally replaces the body. Also handles a document with no frontmatter when only the body changes. The existing `AgentFormModel` helpers are absorbed by this.
- `editJsonValue` (jsonc-parser) is already sufficient for Claude MCP entry edits.

## 3. Main-process architecture

```
src/main/fidelity/         toml-edit (extended), jsonc-edit, frontmatter-edit
src/main/providers/
  shared/edit.ts           form/source → new file content for markdown kinds
  codex/edit.ts            agent TOML field edits, MCP entry edits (setTomlValue)
  claude/edit.ts           MCP entry edits (editJsonValue)
src/main/services/
  transactions.ts          allow-list check, conflict check, atomic write
  backups.ts               snapshot store + retention + restore
  resources.ts             validate / preview / apply / restore orchestration
```

**Adapters** implement `validate(draft)` and `plan(change)` for `update` by delegating to per-kind edit modules. `plan` is pure: given the current file content and the edit, it returns `FileOperationPlan` (`write` operations with full new content — every M3 change is a single-file write).

**Validation** (`adapter.validate`): serialize the proposed content, then re-run the M2 parser for that kind on it. Diagnostics reuse M2 semantics — unparseable content or an empty MCP command → `error`; missing name/description → `warning`. Additional structural checks: source edits of agents must keep valid frontmatter; MCP `args` must be an array of strings and `env` a string→string record. `ok` is false only for errors.

**Transaction service** (`applyPlan(plan, base)`), per parent spec §13:

1. Normalize each operation path and require it under an allowed root: a detected provider config root, `~/.claude.json`, or a registered project directory. Reject symlinked targets that escape the roots (`realpath` check).
2. Conflict check: sha256 of current content vs the `base` fingerprint for every touched path; mismatch → `conflict` AppError (`changed: false`).
3. Snapshot every touched file through the backup service.
4. Write to a temp sibling (`.agent-control-tmp-*`), flush, atomically rename.
5. Re-read and verify the written hash; report `io` AppError with `changed: true` and the backup id if verification fails.

**Backup service**: SQLite migration adds a `backups` table (`id, resource_id, resource_name, provider, kind, operation, created_at`) and `backup_files` (`backup_id, path, content_ref, hash_before, hash_after`). Content lives under `userData/backups/<backupId>/<n>`. After each insert, prune to the latest 50 per resource (delete rows + content dirs). `restore(backupId)`: snapshot current state as a new `restore` backup, then atomically write each file's stored content back (no conflict check — restore is an explicit overwrite; the pre-restore snapshot protects).

**ResourceService** additions: `validate(edit)`, `preview(edit)` (plan + diffs + validation + non-blocking conflict list), `apply(edit)` (re-validate; block on errors; run transaction; return fresh document + backup id), `restore(backupId)`. `read` now computes fingerprints. Apply re-resolves the resource via discovery exactly like `read`, so forged ids/paths cannot escape approved roots.

## 4. Renderer

- **Inspector edit mode.** An Edit button switches the inspector to editing: per-kind form fields (shadcn inputs/textareas; args as one-per-line textarea, env as key=value rows) and, for standalone files, a Source tab with CodeMirror. Form and source are alternative inputs for one save — the last-edited tab wins (matching `ResourceEditPayload`).
- **Save flow.** Save → `resources:preview` → dialog showing per-file unified diff (green/red lines), validation diagnostics, conflict warnings, and "A backup will be created". Errors disable Confirm; warnings require an explicit confirmation checkbox (§8.5). Confirm → `resources:apply` → refresh document + list.
- **Conflict dialog.** A `conflict` error (from preview or apply) offers "Reload latest" (re-read, drop edits) or "Keep editing" (stay in the editor; user may copy their changes out).
- **Backups screen.** New nav entry (parent spec §8.2 already reserves it): table of backups (resource, kind, provider, operation, time) with per-row Restore behind a confirm dialog naming the files to be overwritten. After restore: refresh.
- Credential masking continues to apply to displayed field summaries; the editor shows real values (it edits the user's own local file).

## 5. Error handling

All failures surface as the existing typed `AppError` envelope: `conflict` (external modification), `permission`/`invalid-request` (path outside allowed roots), `io` (write/verify failure — includes `changed: true` and recovery pointing at the backup), `not-found` (resource vanished before apply; backup missing on restore). One failing file operation aborts the transaction; because every M3 plan is a single-file write, partial multi-file states cannot occur.

## 6. Testing

- **Fidelity:** `setTomlValue` replace/insert/escaping with byte-identical-outside-edit assertions; `applyFrontmatterEdit` preserving comments and unknown keys, body-only edits, no-op returns source unchanged.
- **Per-kind planners:** form and source edits produce the expected single `write` operation for each kind × provider, against the M2 fixture tree.
- **Transactions:** allow-list rejection (outside root, symlink escape), conflict detection, atomic temp+rename behavior, post-write verification, temp cleanup on failure.
- **Backups:** record → list → restore round trip in temp dirs; pruning at 50; restore creates a pre-restore snapshot.
- **ResourceService:** end-to-end validate/preview/apply/restore against temp fixture roots; apply blocked by validation errors; fingerprints round trip; stale fingerprints → conflict.
- **IPC:** schema tests for the five new channels.
- No Playwright/E2E (Milestone 5).

## Out of scope (deferred)

- Create, duplicate, import, export, enable/disable, delete (M4).
- File watching, automatic refresh, SQLite resource index (M4).
- Full history/undo screen beyond the minimal Backups screen (M4).
- Whole-file source editing of shared files; TOML syntax highlighting.
- Hooks and plugins kinds; `directory` scope.
