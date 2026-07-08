# Milestone 1: Foundation — Design

**Date:** 2026-07-08
**Status:** Approved
**Parent spec:** `project-specification.md` (Agent Control, Draft v0.1)

## Scope

Milestone 1 of Agent Control: Electron security baseline, React application shell, typed IPC, project registration, provider adapter interface, and the native-fidelity spike. No resource discovery (M2) or editing (M3).

## Adopted decisions (spec §22, accepted as-is)

- macOS first; paths and services stay platform-neutral.
- First resource types (for later milestones): agents, skills, plugins, MCP servers, instruction files.
- Projects are added manually by the user.
- Broad provider configuration is read-only initially.
- Backup retention: latest 50 application-created backups per resource, with a storage cap.
- Product name: **Agent Control** (working title).

Additional M1 decisions:

- Toolchain: **electron-vite**, with electron-builder planned for packaging in M4.
- Package manager: **bun**.
- Sequencing: scaffold → native-fidelity spike → shell/IPC/registration. The spike gates all editor-related work.

## 1. Repo & stack

- Electron (latest stable), React 19, TypeScript strict, Tailwind CSS + shadcn/ui, Zod, `node:sqlite`, Vitest.
- **Amended 2026-07-08:** `node:sqlite` (`DatabaseSync`) instead of better-sqlite3. Verified working inside Electron 43 (bundled Node 24.18) and under system Node 25 for Vitest — no native-module ABI split between test and runtime environments, zero rebuild tooling.
- Layout (electron-vite conventions):

```text
src/main/       Main process: window/security, services, adapters
src/preload/    contextBridge API only
src/renderer/   React app (shell, screens)
src/shared/     IPC contract (Zod schemas), shared types
tests/fixtures/ Provider-config fixtures for the spike
```

## 2. Electron security baseline

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Strict CSP (no remote origins; app is fully local).
- `will-navigate` blocked; `setWindowOpenHandler` denies all window creation.
- Every `ipcMain` handler validates the sender frame and Zod-parses its payload; validation happens in the main process regardless of renderer behavior.
- No generic filesystem methods cross the bridge. The preload exposes only the typed `DesktopApi` (spec §10.2).

## 3. Native-fidelity spike

Proves the three riskiest bets (spec §18, Milestone 1) as Vitest suites before any editing work exists.

Fixtures: sanitized copies modeled on real `~/.codex/config.toml` and `~/.claude/settings.json`, plus synthetic cases (comments in odd places, unknown fields, mixed indentation, trailing commas where legal, inline tables, dotted keys).

1. **TOML round trip:** parse `config.toml` with comments, change one value, serialize. **Amended 2026-07-08:** span-splicing via `toml-eslint-parser` is the primary mechanism — parse to locate the exact byte range of the target value, replace only that range (byte-identical elsewhere by construction). Verified in a live smoke test for both top-level and nested keys. `@rainbowatcher/toml-edit-js` (wasm `toml_edit`) was evaluated and rejected: it cannot address top-level bare keys (`model = "..."` in Codex's `config.toml` fails with "Key Error: path key is empty").
2. **Partial shared-file edits:** modify a single MCP server entry in `config.toml` and a single hook in `settings.json` without disturbing unrelated sections. JSON path: `jsonc-parser` `modify`/`applyEdits` (VS Code's own mechanism for surgical settings.json edits).
3. **Form round trip:** convert a resource with unknown fields and comments into the normalized `ResourceDocument` (spec §11) and back with nothing lost (`native.raw` + `native.unknownFields` carry what the form doesn't model).

**Exit criterion:** automated diff tests showing byte-identical output outside the edited region, against fixtures from both providers. If no library combination achieves this, stop and renegotiate principle 3 ("Native fidelity") before building editors.

## 4. Typed IPC & project registration

- The IPC contract lives in `src/shared/ipc.ts`: one Zod schema pair (request/response) per channel, plus derived TypeScript types.
- A small wrapper in main registers handlers: it checks the sender, parses the request against the schema, and serializes typed errors (spec §16 shape: operation, resource/file, changed?, backup?, recovery hint).
- The preload builds `DesktopApi` from the same contract, so renderer, preload, and main share one source of truth.
- **Wired for real in M1:** `providers.detect`, `projects.add`, `projects.list`, `projects.remove`.
- **Declared but stubbed until M2/M3:** `resources.list/read/validate/preview/apply/restore`.
- Project registration flow: renderer calls `projects.add` → main opens the native folder picker → chosen path is normalized and stored in SQLite (`projects` table: id, name, path, addedAt) → renderer list updates; persists across restart. `projects.remove` deregisters only (never touches the folder).
- SQLite database lives in the app's userData directory; a minimal migration runner creates the schema.

## 5. App shell & provider adapter interface

- Three-column settings layout (spec §8.1): navigation / resource list / inspector, built with shadcn/ui. Light/dark/system themes.
- Navigation tree is generated from adapter `capabilities()` — categories are not hard-coded (spec §8.2).
- `ProviderAdapter` interface and `ProviderRegistry` per spec §10.4. M1 ships Codex and Claude stub adapters:
  - `detect()`: honest minimal check — provider config root exists (`~/.codex`, `~/.claude`) — surfaced on the Overview screen.
  - `capabilities()`: static category lists per spec §8.2.
  - `discover/parse/validate/plan`: throw "not implemented until M2/M3".
- All non-functional screens render intentional empty states naming the milestone that delivers them.

## 6. Error handling & testing

- IPC wrapper returns discriminated typed errors; renderer shows actionable messages for the channels that exist.
- Vitest covers: spike suites (core), IPC schema validation, path normalization for project registration, adapter registry behavior.
- Playwright deferred to later milestones per spec §15/§18.

## Done when

1. App launches with the full security baseline active.
2. Shell renders and navigates; categories come from adapter capabilities.
3. Projects can be added, listed, and removed, and persist across restart.
4. Overview shows real (minimal) provider detection status.
5. All native-fidelity spike tests pass with byte-identical-outside-the-edit guarantees.
