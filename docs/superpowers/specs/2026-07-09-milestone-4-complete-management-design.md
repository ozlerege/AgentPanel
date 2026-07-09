# Milestone 4: Complete management — Design

**Date:** 2026-07-09
**Status:** Approved (decisions resolved from parent spec §9, §13, §21–22 and M3 deferrals; user delegated implementation)
**Depends on:** Milestone 3 (mutation pipeline: TransactionService, BackupService, validate/preview/apply IPC, inspector edit mode, Backups screen)

## Goal

Users can create, duplicate, import, export, enable/disable, and delete resources through the same preview-first, backed-up pipeline that edits use; the app notices external file changes and refreshes automatically; a History screen lists every application-managed change with one-click undo; and the app packages into a distributable (unsigned) macOS build.

## Decisions

1. **One mutation pipeline.** The M3 `resources:validate` / `resources:preview` / `resources:apply` channels widen from `ResourceEdit` to a discriminated `ResourceMutation` union (`edit | create | duplicate | delete | set-enabled`). Every mutation gets the same validation → preview (files + diff + warnings) → backup → atomic apply flow (parent spec §8.5, §13). `apply`'s `document` becomes nullable (delete leaves no document).
2. **Operation support matrix** (per kind; blank = not in M4):

   | kind                | create | duplicate | import | export | enable/disable | delete |
   | ------------------- | :----: | :-------: | :----: | :----: | :------------: | :----: |
   | agents              |   ✓    |     ✓     |   ✓    |   ✓    |       ✓        |   ✓    |
   | skills              |   ✓    |     ✓     |        | ✓ (dir)|       ✓        |   ✓    |
   | commands (claude)   |   ✓    |     ✓     |   ✓    |   ✓    |       ✓        |   ✓    |
   | mcp-servers         |   ✓    |     ✓     |        |        |                |   ✓    |
   | instructions        | ✓ (missing file) | |        |   ✓    |                |   ✓    |

   Skills import (multi-file, possibly binary payloads) and MCP import/export are deferred to M5. Instructions create only offers the fixed filename (`AGENTS.md` / `CLAUDE.md`) at a scope where it does not exist yet.
3. **Disable is an app-managed rename** (parent spec §9 “Disable a resource”): neither provider has a native per-resource disable for file kinds, so the app renames the resource file with a `.disabled` suffix — `reviewer.md → reviewer.md.disabled`, `reviewer.toml → reviewer.toml.disabled`, and for skills the manifest inside the folder: `SKILL.md → SKILL.md.disabled` (renaming the folder would NOT stop Claude Code from loading the skill, since discovery keys off SKILL.md; renaming the manifest does, for both providers). Discovery learns to scan the disabled variants and reports them with `enabled: false`. Enable reverses the rename. MCP servers and instructions stay `enabled: 'unsupported'`. The rename runs through the TransactionService as a new `move` file operation (allow-list both ends, backup, undoable).
4. **Delete** shows the exact file list in the preview dialog, requires confirmation, snapshots everything into a backup, then deletes (parent spec §9). Skills delete removes every file in the skill folder plus the folder itself (new `rmdir` operation that only removes empty directories). MCP delete removes the single entry from the shared file (surgical splice, existing fidelity primitives). After apply the UI offers immediate undo (restore of the returned backupId).
5. **Undo = restore.** `BackupService` already round-trips “file did not exist” (`content: null` → restore deletes), so undoing a create, delete, disable, or duplicate is exactly `resources:restore` of that operation's backup. The `operation` column widens to `update | restore | create | delete | duplicate | enable | disable`. The Backups screen becomes **History**: operation badges, per-row Undo (confirm dialog naming affected files), filter by resource.
6. **Create/duplicate naming.** Names are slugified to `[a-z0-9-]` filenames; the planner refuses to overwrite an existing path (`conflict` diagnostic in validation, not a silent overwrite). Duplicate proposes `<name>-copy`, then `<name>-copy-2`, … for both file kinds and MCP entry keys.
7. **Import (agents, commands).** Renderer calls a new `imports:pick` channel; the MAIN process shows the open dialog, reads the picked file (utf-8, size-capped at 1 MiB), and returns `{ fileName, raw }`. The renderer then submits a normal `create` mutation carrying `raw`, so imported content flows through the same validation/preview/apply path and is treated as untrusted text (never executed, parent spec §14).
8. **Export.** New `resources:export` channel: main process resolves the resource via discovery (forged paths impossible), shows a save dialog (single-file kinds) or directory picker (skills), and copies the native file(s) with `cpSync`. The dialog itself is the explicit confirmation required for writing outside known roots (§14). Export changes nothing inside managed roots — no backup or preview needed. Response `{ savedTo: string | null }` (null = cancelled).
9. **Reveal in file manager** (§8.3): new `resources:reveal` channel; main resolves the resource, calls `shell.showItemInFolder(primaryPath)`.
10. **File watching: chokidar v4** in the main process. Watch provider roots (`~/.codex`, `~/.claude`, `~/.claude.json`) and per project only the config surfaces: `<project>/.claude`, `<project>/CLAUDE.md`, `<project>/AGENTS.md`, `<project>/.mcp.json` — never whole project trees (node_modules). Events debounce (400 ms trailing) into one `resources:changed` push (`webContents.send`); preload exposes `events.onResourcesChanged(cb): () => void` (subscribe/unsubscribe). The renderer refetches the list and, when NOT editing, the open document; while editing it shows the existing conflict machinery instead of clobbering (fingerprints already guard apply). Watcher restarts when the project list changes.
11. **Packaging: electron-builder** (macOS first, parent spec §22). `electron-builder.yml` with `appId: com.egeozler.agent-control`, `productName: Agent Control`, files `out/**` + `resources/**`, `mac.target: [dmg, zip]`, `mac.category: public.app-category.developer-tools`, icon `resources/app-icon.png`, signing disabled (`identity: null` — signed builds are M5). Script `package:mac` runs `electron-vite build && electron-builder --mac`.

## 1. Shared model and IPC

`src/shared/resource.ts`:

```ts
export interface ResourceCreateDraft {
  provider: ProviderId
  kind: string
  scope: 'user' | 'project'
  projectId?: string
  /** Display name; the planner slugifies it into a filename / entry key. */
  name: string
  fields: Record<string, unknown>
  body?: string
  /** Full native content for imports; wins over fields/body when present. */
  raw?: string
}

export type ResourceMutation =
  | { action: 'edit'; resourceId: string; base: FileFingerprint[]; edit: ResourceEditPayload }
  | { action: 'create'; draft: ResourceCreateDraft }
  | { action: 'duplicate'; resourceId: string; newName: string }
  | { action: 'delete'; resourceId: string; base: FileFingerprint[] }
  | { action: 'set-enabled'; resourceId: string; enabled: boolean; base: FileFingerprint[] }
```

`FileOperation.kind` gains `'rmdir'` (removes an empty directory only). `ResourceChange` grows matching optional fields so the adapter contract can carry all mutation shapes (`kind: 'create' | 'update' | 'delete' | 'move'`… kept as-is where possible; the service maps mutations onto it).

`src/shared/ipc.ts`: `resourceMutationSchema` (discriminated on `action`) replaces `resourceEditSchema` as the request for `resources:validate/preview/apply`; `applyResultSchema.document` becomes nullable; `backupEntrySchema.operation` widens to the seven-value enum. New channels:

- `resources:export` — `{ resourceId: string }` → `{ savedTo: string | null }`
- `resources:reveal` — `{ resourceId: string }` → `undefined`
- `imports:pick` — `{ providerId, kind }` → `{ fileName: string; raw: string } | null`

Push event (not in the invoke contract): channel `resources:changed`, payload `undefined`. Preload exposes it as `events.onResourcesChanged(cb)` via `ipcRenderer.on` with a returned unsubscribe; the preload validates the event channel name.

## 2. Main process

```
src/main/services/watcher.ts      WatcherService (chokidar, debounce, restart on project change)
src/main/services/exports.ts      export/reveal/import-pick (dialogs + cpSync; discovery-resolved paths only)
src/main/providers/{codex,claude}/… plan() handles create/delete/move per kind; discovery scans .disabled variants
src/main/providers/shared/create.ts  name slugification, target-path building, collision checks, template content
```

- **Adapters.** `plan()` loses its `not-implemented` guard and dispatches on `ResourceChange.kind`. Create plans produce `write` ops (with template or imported raw content); delete plans enumerate real files at plan time (skills: every file under the folder, then `rmdir`); set-enabled plans produce a single `move` op; duplicate = read current raw → create plan under the new name/key. MCP create/duplicate/delete reuse the M3 fidelity primitives (`setTomlValue`/`deleteTomlKey`/table insertion for Codex; `editJsonValue` with `undefined` for Claude).
- **Discovery + enabled.** Scanners pick up `<file>.disabled` variants (and `SKILL.md.disabled`) and set `enabled: false` on the native/parsed document; active file kinds report `enabled: true`; MCP/instructions keep `'unsupported'`. A resource's id changes across enable/disable (id encodes the path) — the renderer refreshes after apply, acceptable.
- **TransactionService** implements `move` (allow-list + conflict-check source, require absent target, backup records `{from: content, to: null}`, `renameSync`) and `rmdir` (allow-list, `rmdirSync` on empty dir only, not backed up — file deletions before it already are). `apply` accepts `operation` values beyond update/restore for backup labeling.
- **ResourceService** gains mutation orchestration: `validate/preview/apply` accept `ResourceMutation`; create resolves no id but re-validates scope/project against the registered projects; delete/set-enabled resolve via discovery exactly like edit (forged ids cannot escape roots).
- **WatcherService** `start(paths)`, `stop()`, `onChange(cb)`; index.ts wires it to projects-store changes and `webContents.send('resources:changed')` on every open window.

## 3. Renderer

- **Add flow.** “Add” button on the resource list → create dialog: scope picker (user / registered project), name, per-kind fields (reusing the M3 form components), MCP entry form for mcp-servers, “Import file…” secondary action for agents/commands. Save → preview dialog (same component as edit) → apply → refresh + select the new resource.
- **Row/inspector actions.** Dropdown per row + inspector buttons: Duplicate (name prompt seeded with `<name>-copy`), Enable/Disable toggle (preview → apply), Export, Reveal in Finder, Delete (confirm dialog listing exact files, typed by the preview response). After delete: toast/dialog with Undo (calls restore with the returned backupId).
- **History screen.** Nav item renamed Backups → History (key stays `backups`). Adds operation badges (`create`, `delete`, `disable`…), resource filter, Undo per row (existing restore flow + confirm naming files).
- **Auto refresh.** App-level subscription to `events.onResourcesChanged`: refetch list; refetch open inspector document only when not in edit mode.

## 4. Error handling

Existing `AppError` codes cover M4: `conflict` (stale base fingerprints on delete/disable, or create-target already exists at apply time), `permission` (path outside roots), `not-found` (resource vanished), `io` (rename/write failures, with backup pointer in `recovery`), `invalid-request` (bad names, unsupported operation for kind). Validation errors block apply in the main process, warnings require UI confirmation — unchanged from M3.

## 5. Testing

- **Planner tests per kind × operation** (create/duplicate/delete/set-enabled) against the M2/M3 fixture tree: exact operation lists, template content, collision `conflict` diagnostics, MCP entry splicing byte-identical outside the edited span.
- **TransactionService:** move (success, target-exists rejection, allow-list both ends, backup round trip), rmdir (empty-only, allow-list).
- **ResourceService:** create → list shows it; delete → restore(backupId) resurrects files byte-identical; disable → discovery reports `enabled: false` → enable restores the original path; duplicate collision naming.
- **Discovery:** `.disabled` fixtures for agents/commands/skills report `enabled: false`.
- **WatcherService:** temp-dir change → single debounced callback; project add/remove restarts watching (chokidar mocked or real with timeouts).
- **IPC:** schema tests for the mutation union, export/reveal/imports channels, widened backup operations.
- Packaging verified once by building `--mac --dir` and checking the .app launches (manual smoke, explicitly authorized in the plan).

## Out of scope (M5)

- Signed/notarized builds, auto-update, Windows/Linux packaging.
- Skills and MCP import; MCP export; hooks and plugins kinds.
- E2E (Playwright) coverage; accessibility pass.
- SQLite search index (list performance is fine at current scale).
