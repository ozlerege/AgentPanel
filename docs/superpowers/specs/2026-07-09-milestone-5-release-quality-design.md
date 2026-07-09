# Milestone 5: Release quality — Design

**Date:** 2026-07-09
**Status:** Approved (scope = parent spec §18 M5 verbatim; M4-deferred features stay out of the MVP per user decision)
**Depends on:** Milestones 1–4 (full management pipeline, watching, history, unsigned macOS packaging)

## Goal

The app is releasable: an end-to-end test matrix drives the real packaged renderer through every MVP flow against disposable fixture roots; interrupted writes are proven recoverable; the UI passes an accessibility gate; and builds can be signed, notarized, auto-updated, and shipped by following a documented release process.

## Decisions

1. **E2E stack: Playwright's Electron driver** (`@playwright/test`, `_electron.launch` on the electron-vite build output). No browser downloads needed. Specs live in `tests/e2e/*.spec.ts`, excluded from Vitest; script `test:e2e` runs `electron-vite build` first (explicitly authorized — E2E is meaningless without a fresh build).
2. **Test-root seam.** Parent spec §20: never run destructive tests against real config directories. The main process learns environment overrides, read once at startup: `AC_CODEX_ROOT`, `AC_CLAUDE_ROOT`, `AC_CLAUDE_JSON` (paths for the two provider roots and the shared user MCP file) and Electron's own `--user-data-dir` handling via `app.setPath('userData', process.env.AC_USER_DATA)` when set. Adapter factories already accept `configRoot`/`userMcpPath` options — the seam only threads env values into `createDefaultRegistry`, the transaction allow-list, and the watcher path builder. Overrides are ignored when the variables are unset; production behavior is unchanged.
3. **E2E matrix** (parent spec §20): provider detection against seeded fixture roots; list/search/filter; create (agent) and the created file appearing on disk; edit through form AND source with byte-accurate round trip; disable → discovery shows disabled → enable; delete with confirm → undo restores the file; restore from History; external-edit conflict warning (test mutates the file behind the app's back mid-edit); keyboard-only navigation of the primary flow; app restart retains registered projects and history (SQLite recovery).
4. **Recovery testing for interrupted writes** is two-layered:
   - **Fault injection (Vitest):** `TransactionService` gets an injectable fs facade (defaulting to `node:fs`) so tests can fail `renameSync`/`writeSync` mid-multi-file plan and assert: earlier files' backups exist, the error's `changed` flag is accurate per file, `recovery` names the backup id, and restoring that backup returns every touched file to its pre-transaction bytes.
   - **Stale temp cleanup:** a startup sweep removes abandoned `.agent-control-tmp-*` files in provider roots and registered projects (crash between temp-write and rename leaves them). Main-process service with unit tests; runs after services are constructed, logs (never throws) on failure.
5. **Accessibility gate:** `@axe-core/playwright` scans Overview, a resource list, the inspector (view + edit), the create dialog, History, and Settings — zero `serious`/`critical` violations, enforced as an E2E spec. Fix what the scan and a manual keyboard pass surface, expected: `aria-label`s on icon-only buttons, `focus-visible` rings on all interactive elements, dialog focus trapping (radix provides — verify), status conveyed by text/icon not color alone (parent spec §17), `role="status"`/`aria-live` for async success/error surfaces.
6. **Signed builds + notarization: config and documentation, not execution.** No Apple Developer identity exists in this environment, so signing must be reproducible by the user, not performed here: `electron-builder.yml` gains `mac.hardenedRuntime: true`, entitlements file (`build/entitlements.mac.plist` — allow-jit only if required by Electron defaults), and identity/notarization driven entirely by standard env vars (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` via electron-builder's `notarize: true`). With no env set, builds stay unsigned-but-buildable exactly as today (`identity: null` moves to a documented dev override rather than the default).
7. **Update strategy: electron-updater over GitHub Releases** (repo already on GitHub). `electron-updater` checks in packaged builds only, on a 5-second-after-launch timer; an update found → dialog offering download/install on quit; errors are logged, never surfaced as blocking dialogs. macOS auto-update requires a signed build — the updater no-ops (log line) when the build is unsigned, so dev/unsigned artifacts never half-update. `publish: { provider: github }` in electron-builder config.
8. **Release documentation:** `docs/RELEASING.md` — version bump, changelog expectations, env vars for signing/notarization, `bun run package:mac`, verifying the artifact, publishing the GitHub release (electron-builder `--publish always` path), and post-release smoke checklist. README gets a short "Development" and "Release" pointer section.

## Out of scope (post-MVP backlog)

Plugins and hooks resource kinds; skills/MCP import; MCP export; `directory` scope; Windows/Linux packaging; CI pipeline setup (the release doc describes local release; CI is a follow-up).

## Testing summary

Vitest: fs-facade fault injection, temp-file sweep, env-seam unit tests. Playwright: the §20 E2E matrix + axe gate + restart recovery. Everything runs against `mkdtemp` fixture roots seeded per test; the suite never reads or writes `~/.codex`, `~/.claude`, or `~/.claude.json`.
