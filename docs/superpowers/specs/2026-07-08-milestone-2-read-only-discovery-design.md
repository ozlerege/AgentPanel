# Milestone 2: Read-only discovery — Design

**Date:** 2026-07-08
**Status:** Approved
**Depends on:** Milestone 1 (fidelity primitives, typed IPC, projects store, adapter stubs, app shell)

## Goal

Make discovery real: the app detects installed providers, scans their user-level and registered-project resources through the Codex and Claude adapters, and lets the user list, search, filter, and inspect resources with validation diagnostics — all read-only.

## Decisions made during brainstorming

1. **Resource kinds:** agents, skills, commands (Claude-only), MCP servers, instructions. Plugins and hooks are deferred to a follow-up milestone.
2. **Data flow:** scan-on-demand. No SQLite index and no main-process cache in M2; the renderer triggers a fresh scan on navigation/refresh and does search/filter client-side. The index arrives with file watching in Milestone 4.
3. **Diagnostics depth:** parse errors plus missing required fields. Deeper semantic checks (shadowing, PATH lookups) are out of scope.
4. **Adapter internals:** explicit per-kind scanner modules sharing small low-level helpers — no declarative descriptor engine.

## 1. Scope and resource locations

Two scopes in M2: `user` and `project` (each registered project). The `directory` scope stays unused.

| Kind | Codex | Claude Code |
|---|---|---|
| Agents | `~/.codex/agents/*.toml` | `~/.claude/agents/*.md`, `<project>/.claude/agents/*.md` |
| Skills | `~/.codex/skills/*/SKILL.md` | `~/.claude/skills/*/SKILL.md`, `<project>/.claude/skills/*/SKILL.md` |
| Commands | — (not a Codex capability category) | `~/.claude/commands/**/*.md`, `<project>/.claude/commands/**/*.md` |
| MCP servers | `~/.codex/config.toml` → `[mcp_servers.<name>]` | `~/.claude.json` → top-level `mcpServers` (user); `<project>/.mcp.json` → `mcpServers` (project) |
| Instructions | `~/.codex/AGENTS.md` (user), `<project>/AGENTS.md` | `~/.claude/CLAUDE.md` (user), `<project>/CLAUDE.md` |

Notes grounded in real files on this machine:

- Codex agent TOML fields: `name`, `description`, `developer_instructions` (all string).
- Codex MCP entries: `command` (required), `args`, `env` (sub-table), optional extras like `startup_timeout_sec`. Unknown keys are preserved and displayed generically.
- Claude agents/commands: Markdown with YAML frontmatter (`name`, `description`, `model`, `tools`, …); commands may nest in subdirectories (namespaced names, e.g. `frontend/component`).
- Skills (both providers): directory containing `SKILL.md` with `name`/`description` frontmatter; supporting files listed but not parsed.
- Codex project scope covers instructions only (`AGENTS.md`); Codex has no standard project-level agents/skills/MCP locations.

**Capabilities honesty:** the M1 `capabilities()` category lists shrink to what M2 discovery actually serves — Codex: agents, skills, mcp-servers, instructions; Claude: agents, skills, commands, mcp-servers, instructions. Plugins and hooks reappear when their discovery ships. The nav is generated from capabilities, so it adjusts automatically.

**Enabled state:** all five kinds report `enabled: 'unsupported'` in M2 (no native per-resource disable mechanism applies to them). Row status is driven by diagnostics: `error` → invalid badge, `warning` → warning indicator, else healthy.

## 2. Main-process architecture

```
src/main/providers/
  shared/
    frontmatter.ts      # split + YAML-parse frontmatter → { fields, body, diagnostics }
    scan.ts             # safe enumeration: missing dir → [], unreadable entry → contained
    resource-id.ts      # stable id encode/decode
  codex/
    agents.ts  skills.ts  mcp-servers.ts  instructions.ts
  claude/
    agents.ts  skills.ts  commands.ts  mcp-servers.ts  instructions.ts
```

Each scanner module exposes two pure-ish functions:

- `discover(roots): NativeResource[]` — enumerate what exists (paths, kind, scope, projectId). Filesystem reads only for enumeration.
- `parse(native): ResourceDocument` — read + parse one resource, producing normalized fields, `native.raw`, and diagnostics. Never throws for content problems; contains them as diagnostics.

The M1 adapter factories (`createCodexAdapter`, `createClaudeAdapter`) keep their signatures and delegate `discover`/`parse` to the scanner modules, replacing the not-implemented stubs. `validate` and `plan` remain not-implemented (Milestone 3).

MCP scanners parse one shared file and emit one resource per server entry; `sourcePaths` points at the shared file. A malformed shared file yields a single synthetic "MCP configuration" resource carrying the parse-error diagnostic so the failure is visible in the list.

### ResourceService

New `src/main/services/resources.ts`, constructed with the provider registry and the projects store:

- `list(query: ResourceQuery): ResourceSummary[]` — build `DiscoveryContext` from registered projects, run discover+parse across the adapters/kinds/scopes matching the query, return summaries (no raw content).
- `read(id: string): ResourceDocument` — decode the id, **verify the path is under an approved root** (provider config root, `~/.claude.json`, or a registered project directory), then re-discover/parse that single resource fresh. Unknown or out-of-root ids → `not-found` / `invalid-request` AppError.

### Resource ids

Deterministic encoding of `(provider, kind, scope, projectId?, path, entryKey?)` — `entryKey` distinguishes entries within shared files (MCP server name). Encoded as a URL-safe base64 JSON tuple; stable across rescans so renderer selection survives refresh.

## 3. IPC and DesktopApi

Two new channels in `src/shared/ipc.ts` following the M1 envelope/validation pattern:

- `resources:list` — request `{ providerId?, kind?, scope?, projectId? }` (all optional) → `ResourceSummary[]`.
- `resources:read` — request `{ id: string }` → `ResourceDocument`.

New Zod schemas: `resourceQuerySchema`, `resourceSummarySchema`, `resourceDocumentSchema` (mirrors `src/shared/resource.ts`'s `ResourceDocument`), `diagnosticSchema`. `ResourceSummary` = `ResourceDocument` minus `fields` and `native` (id, provider, kind, name, description, scope, projectId, enabled, sourcePaths, diagnostics, modifiedAt).

`DesktopApi` gains `resources.list(query)` and `resources.read(id)`. The preload wires them exactly like the existing project methods. No generic filesystem methods (spec §10.2).

## 4. Renderer UI

- Selecting a provider category in the nav renders `ResourceListScreen` for `(providerId, categoryId)`; categories continue to come from `capabilities()`.
- **List column:** search input (name + description substring, case-insensitive), scope filter (All / User / per registered project), refresh button. Rows per spec §8.3: name, description (truncated), scope badge, last-modified time, warning/error indicator when diagnostics exist. All filtering client-side over the fetched summaries.
- **Inspector column:** on row selection, `resources.read(id)`. Shows summary header (name, kind badge, provider logo, scope, source paths), a per-kind key-fields section, the diagnostics list (severity icon + message), and a read-only source view rendering `native.raw` in a scrollable `<pre>`. Monaco waits for M3 editing.
- Empty states: provider not detected, no resources in category, no matches for search.
- Overview screen upgrade is out of scope except where trivial (counts can come later).

**Credential masking (spec §14):** the key-fields section masks probable credentials — MCP `env` values and arg tokens matching secret-like patterns (e.g. `sbp_…`, `sk-…`, `token=`) render as `••••`. The raw source view shows the file as-is (it is the user's own local file); masking applies to the summarized fields UI only.

## 5. Diagnostics and error handling

Diagnostic producers, per kind:

- **Parse failure** (invalid TOML/JSON/JSONC/frontmatter): resource still listed, named from its file/entry, `error` diagnostic with parser message, raw content preserved, `native.format: 'unknown'` only if format truly undeterminable.
- **Required fields:** agent missing `name`/`description`; skill `SKILL.md` missing `name`/`description` frontmatter, or skill directory missing `SKILL.md` entirely; command file empty; MCP server entry missing `command` (or `url` for remote transports); instructions have no required fields (empty file → `info`).
- Severity: missing name/description or empty command file → `warning`; unparseable content or missing SKILL.md → `error`.

Containment rules:

- One broken resource never fails the list; missing directories yield empty results; an unreadable file (permissions) becomes a resource with an `error` diagnostic.
- `list` never throws for content reasons; only infrastructure failures surface as AppError.
- `read(id)` of a since-deleted resource → `not-found` AppError with the path.

## 6. Testing

- Fixture trees under `tests/fixtures/discovery/{codex,claude}/` replicating a user config root and one project directory, including per kind: a healthy resource, one with missing required fields, and one malformed file.
- Per-scanner Vitest tests: discovery counts and paths, parsed fields, diagnostics on the broken fixtures, byte-exact `native.raw`.
- `ResourceService` tests: query filtering (provider/kind/scope/project), id round-trip, read-after-list stability, path-safety rejection of forged ids.
- IPC schema tests extending `src/shared/ipc.test.ts` for the new channels.
- Credential-masking unit tests for the fields summarizer.
- No Playwright/E2E (Milestone 5).

## Out of scope (deferred)

- Plugins and hooks discovery.
- SQLite resource index, fingerprints, file watching (M4).
- Any write operation, enable/disable, reveal-in-file-manager, export (M3/M4).
- Monaco source editor (M3).
- `directory` scope resources.
