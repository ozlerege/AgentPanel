# Milestone 5: Release Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Implementer note:** Written for a high-capability implementer (gpt-5.6-terra via Codex, high reasoning effort) with full repository access. Cross-task contracts are exact and MUST be used verbatim; code bodies follow existing codebase idioms — study the sibling module and its tests first. TDD wherever a runnable test exists at authoring time.
>
> **E2E execution caveat:** the Codex sandbox likely cannot launch Electron windows. Author the Playwright specs, make them typecheck, and TRY `bun run test:e2e`; if Electron fails to launch for sandbox reasons, say so in the report and mark the specs "authored, unexecuted" — the orchestrator runs them outside the sandbox and returns failures for a follow-up pass. Never weaken a spec just to make it pass in a broken environment.

**Goal:** E2E test matrix over the real app against disposable fixture roots; proven recovery from interrupted writes; an enforced accessibility gate; signing/notarization/auto-update wiring driven by env vars; documented release process.

**Architecture:** A small env seam (`AC_CODEX_ROOT`, `AC_CLAUDE_ROOT`, `AC_CLAUDE_JSON`, `AC_USER_DATA`) makes every filesystem surface injectable at app launch; Playwright's Electron driver runs the built app per-test on `mkdtemp` fixture roots; `TransactionService` gains an injectable fs facade for fault injection; electron-builder config becomes signing/notarization/publish-ready with electron-updater guarded to signed packaged builds.

**Tech Stack:** Existing stack plus `@playwright/test` + `@axe-core/playwright` (devDependencies) and `electron-updater` (dependencies). All three are ALREADY INSTALLED — never run package-manager installs.

**Spec:** `docs/superpowers/specs/2026-07-09-milestone-5-release-quality-design.md`

## Global Constraints

- Never use `any`. bun only. Never `bun run dev`.
- `bun run build` is authorized ONLY as part of `test:e2e` (Task 2 defines it) and Task 7's final verification.
- Unit verification: `bun run typecheck` && `bun run test` after every task. E2E verification: `bun run test:e2e` (see caveat above).
- E2E and unit tests must NEVER touch `~/.codex`, `~/.claude`, or `~/.claude.json` — fixture roots only, via the Task 1 seam.
- Production behavior with no `AC_*` env set must be byte-for-byte unchanged.
- SKIP all git commits (sandbox cannot write .git); report exact per-task file lists (created/modified) instead.
- Do not touch `resources/app-icon-v2.png` / `app-icon-v3.png`.

---

### Task 1: Environment seam for config roots and user data

**Files:**

- Create: `src/main/config-roots.ts`, `src/main/config-roots.test.ts`
- Modify: `src/main/index.ts`, `src/main/providers/registry.ts`, `src/main/services/watcher.ts` (+ its test)

**Interfaces (exact):**

```ts
// src/main/config-roots.ts
export interface ConfigRoots {
  codexRoot: string      // AC_CODEX_ROOT  || join(homedir(), '.codex')
  claudeRoot: string     // AC_CLAUDE_ROOT || join(homedir(), '.claude')
  claudeJson: string     // AC_CLAUDE_JSON || join(homedir(), '.claude.json')
}
export function resolveConfigRoots(env: NodeJS.ProcessEnv): ConfigRoots
```

- `createDefaultRegistry(roots: ConfigRoots)` passes `configRoot`/`userMcpPath` into the adapter factories (they already accept these options).
- `resourceWatchPaths(roots: ConfigRoots, projects: Array<{ path: string }>)` replaces the `home` parameter (same surfaces, derived from the roots; update the existing test).
- Transaction allow-list in `index.ts` uses `roots.codexRoot`, `roots.claudeRoot`, `roots.claudeJson`.
- `index.ts`, before `app.whenReady()`: `if (process.env['AC_USER_DATA']) app.setPath('userData', process.env['AC_USER_DATA'])`.
- [ ] Failing tests: `resolveConfigRoots({})` yields homedir defaults; env values win; watcher test updated to the new signature and still proves no whole-root watching.
- [ ] Implement; `bun run test` + `bun run typecheck` green.

### Task 2: Playwright harness and boot smoke

**Files:**

- Create: `playwright.config.ts`, `tests/e2e/launch.ts`, `tests/e2e/smoke.spec.ts`
- Modify: `package.json` (script `"test:e2e": "electron-vite build && playwright test"`), `vitest.config.ts` (exclude `tests/e2e/**`)

**Contracts:** `launch.ts` exports `launchApp(seed?: (roots: SeededRoots) => void)` → `{ app: ElectronApplication, page: Page, roots: SeededRoots, close(): Promise<void> }` where `SeededRoots = { home: string; codexRoot: string; claudeRoot: string; claudeJson: string; userData: string; projectDir: string }`, all under one `mkdtemp`. It launches `_electron.launch({ args: ['out/main/index.js'], env: {...process.env, AC_CODEX_ROOT, AC_CLAUDE_ROOT, AC_CLAUDE_JSON, AC_USER_DATA} })` and waits for the first window. Default seed: minimal codex root (`config.toml` with one MCP server, one agent toml) and claude root (one agent md, one skill, `CLAUDE.md`), mirroring `tests/fixtures/discovery/`. Playwright config: `testDir: 'tests/e2e'`, `workers: 1`, `fullyParallel: false`, generous `timeout: 30_000`.

- [ ] smoke.spec: app window opens; Overview shows both providers detected; sidebar lists categories from capabilities.
- [ ] Vitest still green and does not pick up e2e specs; `bun run typecheck` covers the new files (add tsconfig include if needed).

### Task 3: E2E matrix

**Files:** Create `tests/e2e/discovery.spec.ts`, `tests/e2e/editing.spec.ts`, `tests/e2e/lifecycle.spec.ts`, `tests/e2e/persistence.spec.ts` (extend `launch.ts` with helpers as needed — e.g. `registerProject(page, dir)` via the projects screen is NOT possible (native dialog); instead seed the SQLite projects table through a `AC_SEED_PROJECT` env var handled in `launch.ts` by pre-creating the userData DB, or add the project row directly with `node:sqlite` against the userData path before launch. Choose the DB-seeding approach; never automate native dialogs.)

Matrix (each item one `test()`):

- **discovery**: seeded resources appear with names/scopes; search narrows; scope filter works; diagnostics badge shows for a seeded broken agent.
- **editing**: form edit of a claude agent description → preview shows diff → apply → file on disk contains the change and nothing else changed (byte-compare rest); source edit round trip preserves an unknown frontmatter field and a comment; external modification between open-editor and apply → conflict surface appears, file NOT overwritten.
- **lifecycle**: create codex agent via Add dialog → file exists with template content; disable it → file renamed `.toml.disabled` and row shows disabled; enable → original name back; delete with confirm → file gone → Undo in the success surface → file back byte-identical; History screen lists these operations and Undo of the earlier update restores prior content.
- **persistence**: seeded project + a backup entry survive `close()` + relaunch with the same userData (restart recovery).
- [ ] Author all specs; attempt `bun run test:e2e`; report per-spec pass/fail/unexecuted.

### Task 4: Interrupted-write recovery

**Files:**

- Modify: `src/main/services/transactions.ts` (+ test)
- Create: `src/main/services/temp-sweep.ts`, `src/main/services/temp-sweep.test.ts`
- Modify: `src/main/index.ts` (run sweep at startup after services are built)

**Contracts:** `TransactionService` constructor gains optional third arg `fsFacade: Pick<typeof import('node:fs'), 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync' | 'renameSync' | 'unlinkSync' | 'rmdirSync' | 'mkdirSync' | 'existsSync' | 'rmSync'>` defaulting to `node:fs` — every fs call inside `execute` goes through it (allow-list/realpath checks may keep using node:fs directly). `sweepStaleTempFiles(roots: string[]): string[]` removes files matching `/^\.agent-control-tmp-/` anywhere under the given roots, returns removed paths, swallows (returns without) unreadable subtrees.

- [ ] Fault-injection tests: multi-file plan where the SECOND write's `renameSync` throws → error is `io`, first file already renamed (changed) and its backup content correct, restore of the reported backupId returns BOTH files to pre-transaction bytes; write failure BEFORE rename (openSync throws) → `changed: false`, target untouched, temp absent.
- [ ] Sweep tests: stale temp files removed across nested dirs; fresh non-matching files untouched; missing root tolerated.
- [ ] Wire sweep into startup with the Task 1 roots + registered project paths.

### Task 5: Accessibility gate and fixes

**Files:** Create `tests/e2e/a11y.spec.ts`; modify renderer components as the scan/manual pass requires (expected: `NavSidebar`, `ResourceListScreen`, `ResourceActions`, inspector/dialog components, `HistoryScreen`).

- Axe scan (via `@axe-core/playwright`) of: Overview, Codex Agents list, inspector view mode, inspector edit mode, create dialog, History, Settings. Gate: zero `serious`/`critical` violations — the spec asserts an empty violation array filtered to those impacts.
- Manual-pass fixes required by parent spec §17 regardless of axe: every icon-only button has `aria-label`; keyboard: Tab reaches list rows/actions and Enter activates (add a keyboard-flow `test()` covering select-resource → open actions menu → close with Escape); status badges include text (not color-only); async success/error containers get `role="status"` / `role="alert"` (some exist — verify).
- [ ] Author spec + fixes; unit suite/typecheck green; report axe results if runnable.

### Task 6: Signing, notarization, and auto-update wiring

**Files:**

- Create: `build/entitlements.mac.plist`
- Modify: `electron-builder.yml`, `src/main/index.ts`
- Create: `src/main/services/updater.ts`, `src/main/services/updater.test.ts`

**Contracts:** electron-builder.yml — `mac.hardenedRuntime: true`, `mac.gatekeeperAssess: false`, `mac.entitlements` + `entitlementsInherit` → `build/entitlements.mac.plist` (Electron-required minimum: `com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`), `notarize: true` only takes effect when Apple env vars are present — since electron-builder notarizes whenever credentials exist, no config flag gymnastics needed; REMOVE `identity: null` (document `CSC_IDENTITY_AUTO_DISCOVERY=false` as the dev escape hatch in RELEASING.md and set it in the `package:mac` script via `cross-env`? No — keep the script plain; document the env var instead). Add `publish: { provider: github, owner: ozlerege, repo: AgentPanel }`.

`updater.ts`: `export function initAutoUpdate(log: (line: string) => void): void` — no-ops (with a log line) unless `app.isPackaged`; on macOS also requires a code-signed build (detect via `autoUpdater` error path — wrap `checkForUpdatesAndNotify` in try/catch and treat failures as log-only). 5s `setTimeout` after ready. Unit tests cover the guard logic with a fake (extract a pure `shouldCheckForUpdates(isPackaged: boolean): boolean` + error-swallowing wiring test if electron mocking is impractical — keep it honest, don't fake-test the electron-updater internals).

- [ ] Config + entitlements + updater with tests; typecheck/unit green. Do NOT run electron-builder in-sandbox.

### Task 7: Release documentation and final verification

**Files:** Create `docs/RELEASING.md`; modify `README.md` (Development / Release pointers; create README if absent).

RELEASING.md covers: prerequisites (Apple Developer ID cert, app-specific password, team id; the exact env vars), version bump in package.json, `bun run test` + `bun run test:e2e` gate, `bun run package:mac` (signed when env present; `CSC_IDENTITY_AUTO_DISCOVERY=false` for local unsigned), artifact verification (`codesign --verify --deep --strict`, `spctl --assess`), publishing via `bunx electron-builder --mac --publish always`, post-release smoke checklist (install dmg, boot, auto-update log line).

- [ ] Docs written; `bun run typecheck` + `bun run test` green (final full pass).

---

## Phases (orchestrator)

- **Phase A:** Tasks 1–3. **Phase B:** Tasks 4–5. **Phase C:** Tasks 6–7. Orchestrator runs `test:e2e` outside the sandbox after each phase and feeds failures back.
