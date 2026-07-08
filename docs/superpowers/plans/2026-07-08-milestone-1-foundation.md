# Milestone 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Agent Control foundation — secure Electron scaffold, proven native-fidelity editing primitives, typed IPC, project registration persisted in SQLite, provider adapter interface, and a three-column app shell.

**Architecture:** Electron main process owns all filesystem/DB access behind a Zod-validated IPC contract; a sandboxed CJS preload exposes only the typed `DesktopApi`; the React renderer never touches Node. The native-fidelity spike (Tasks 2–4) gates everything after scaffolding: it proves byte-identical partial edits to TOML/JSONC and lossless form round trips before any editor work in later milestones.

**Tech Stack:** Electron 43, electron-vite 5, React 19, TypeScript (strict), Tailwind CSS 4, Zod 4, `node:sqlite` (DatabaseSync), `toml-eslint-parser` (span-splice edits), `jsonc-parser`, `yaml`, Vitest 4. Package manager: **bun**.

## Global Constraints

- Never use `any` in TypeScript (user rule). Use precise types or `unknown` + narrowing.
- Package manager is **bun** (`bun add`, `bun run`, `bunx`). Never npm/yarn/pnpm.
- Verification commands are `bun run typecheck` and `bun run test`. Do NOT run `bun run dev`. Do NOT run `bun run build` except in Task 11 (final launch verification), where it is explicitly authorized.
- Renderer must never receive Node/fs access; no generic `readFile`/`writeFile` across the IPC bridge (spec §10.2).
- Electron security invariants: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, deny window creation, block navigation, validate sender + Zod-parse payload for every IPC handler (spec §14).
- Adapter categories are data returned by `capabilities()` — the renderer must not hard-code category lists (spec §8.2).
- All fidelity edits must be byte-identical outside the edited region (spec §18 Milestone 1 exit criterion).
- Commit after every task with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verified library facts (do not re-litigate): `node:sqlite` works in Electron 43 (Node 24.18) and system Node 25; `toml-eslint-parser` span-splice handles top-level and nested keys; `@rainbowatcher/toml-edit-js` is REJECTED (cannot edit top-level bare keys); `jsonc-parser` `modify`/`applyEdits` preserves comments/formatting; `yaml` `parseDocument` preserves comments (normalizes only whitespace-before-comment on the edited line).

---

### Task 1: Project scaffold (electron-vite + React + TypeScript + Vitest)

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `electron.vite.config.ts`
- Create: `vitest.config.ts`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/env.d.ts`
- Create: `src/renderer/src/assets/main.css`

**Interfaces:**
- Produces: repo layout `src/main`, `src/preload`, `src/renderer/src`, `src/shared` (created by later tasks), `tests/`; scripts `typecheck`, `test`, `dev`, `start`, `build`; preload output is CJS at `out/preload/index.cjs`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "agent-control",
  "version": "0.1.0",
  "description": "Local desktop configuration manager for Codex and Claude Code",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "start": "electron-vite preview",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "jsonc-parser": "^3.3.1",
    "toml-eslint-parser": "^1.0.3",
    "yaml": "^2.9.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.2",
    "@types/node": "^26.1.1",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.3",
    "clsx": "^2.1.1",
    "electron": "^43.1.0",
    "electron-vite": "^5.0.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "tailwind-merge": "^3.6.0",
    "tailwindcss": "^4.3.2",
    "typescript": "^5.9.3",
    "vite": "^7.0.0",
    "vitest": "^4.1.10"
  }
}
```

Note: `dependencies` holds only what the main process requires at runtime (electron-vite externalizes them); React/Tailwind/clsx are bundled into the renderer, so they live in `devDependencies`. `electron-vite@5` peer-allows vite `^7` only — do not bump vite to 8.

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
out/
dist/
*.log
.DS_Store
```

- [ ] **Step 3: Write `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    // Sandboxed preloads cannot load ESM or require() external packages:
    // bundle everything (no externalizeDepsPlugin) and emit CommonJS.
    build: {
      rollupOptions: {
        output: { format: 'cjs' }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node'
  }
})
```

- [ ] **Step 5: Write `tsconfig.node.json`** (main + preload + shared + tests)

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": [
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*",
    "tests/**/*",
    "electron.vite.config.ts",
    "vitest.config.ts"
  ]
}
```

- [ ] **Step 6: Write `tsconfig.web.json`** (renderer + shared)

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "baseUrl": ".",
    "paths": {
      "@renderer/*": ["src/renderer/src/*"],
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 7: Write minimal `src/main/index.ts`** (security webPreferences from day one; hardening expands in Task 8)

```ts
import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 8: Write placeholder `src/preload/index.ts`** (real API in Task 9)

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('desktopApi', {})
```

- [ ] **Step 9: Write renderer entry files**

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Agent Control</title>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

(Contingency: if dev-mode HMR fails with a "@vitejs/plugin-react can't detect preamble" error, add `'unsafe-inline'` to `script-src` — then flag it in the task report so we revisit a dev-only CSP split.)

`src/renderer/src/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/src/App.tsx` (placeholder, replaced in Task 10):

```tsx
export default function App() {
  return <h1 className="p-4 text-lg font-semibold">Agent Control</h1>
}
```

`src/renderer/src/env.d.ts` (placeholder; the `desktopApi` declaration lands in Task 9):

```ts
/// <reference types="vite/client" />
```

`src/renderer/src/assets/main.css` (placeholder; full theme in Task 10):

```css
@import 'tailwindcss';
```

- [ ] **Step 10: Install and verify**

Run: `bun install`
Expected: lockfile created, no errors. (Electron's postinstall downloads the binary — allow a few minutes.)

Run: `bun run typecheck`
Expected: both tsc invocations exit 0.

Run: `bun run test`
Expected: Vitest exits 0 reporting "no test files found" (passWithNoTests not needed — if Vitest exits non-zero for zero tests, add `passWithNoTests: true` to `vitest.config.ts` test options).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold electron-vite app with React, TypeScript, Vitest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Fidelity spike — span-splice TOML editing

**Files:**
- Create: `src/main/fidelity/toml-edit.ts`
- Create: `src/main/fidelity/toml-edit.test.ts`
- Create: `tests/fixtures/codex/config.toml`
- Create: `tests/helpers/diff.ts`

**Interfaces:**
- Produces: `editTomlValue(source: string, path: Array<string | number>, newValueToml: string): string` and `TomlKeyNotFoundError` from `src/main/fidelity/toml-edit.ts`; `changedLineNumbers(before: string, after: string): number[]` from `tests/helpers/diff.ts` (1-indexed line numbers, used by Tasks 3–4 tests).

- [ ] **Step 1: Write the fixture `tests/fixtures/codex/config.toml`**

```toml
# Codex CLI configuration
# Hand-maintained ordering. Do not sort keys.

model = "gpt-5.5" # primary model
approval_policy = "on-request"
sandbox_mode = "workspace-write"

# Flags Agent Control does not understand and must never drop.
[experimental]
raw_agents = true
undocumented_setting = "keep-me"

[sandbox_workspace_write]
network_access = true

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.filesystem]
# local files server
command = "old-cmd"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/Users/example"]

[mcp_servers.filesystem.env]
FILESYSTEM_ROOT = "/Users/example"
```

- [ ] **Step 2: Write the diff helper `tests/helpers/diff.ts`**

```ts
export function changedLineNumbers(before: string, after: string): number[] {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const changed: number[] = []
  const max = Math.max(beforeLines.length, afterLines.length)
  for (let i = 0; i < max; i++) {
    if (beforeLines[i] !== afterLines[i]) changed.push(i + 1)
  }
  return changed
}
```

- [ ] **Step 3: Write the failing tests `src/main/fidelity/toml-edit.test.ts`**

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changedLineNumbers } from '../../../tests/helpers/diff'
import { TomlKeyNotFoundError, editTomlValue } from './toml-edit'

const fixture = readFileSync(
  join(import.meta.dirname, '../../../tests/fixtures/codex/config.toml'),
  'utf8'
)

describe('editTomlValue', () => {
  it('edits a top-level key changing only its line', () => {
    const result = editTomlValue(fixture, ['model'], '"o3"')
    expect(result).toContain('model = "o3" # primary model')
    expect(changedLineNumbers(fixture, result)).toEqual([4])
  })

  it('edits one MCP server entry without touching its siblings', () => {
    const result = editTomlValue(
      fixture,
      ['mcp_servers', 'filesystem', 'command'],
      '"new-cmd"'
    )
    expect(result).toContain('command = "new-cmd"')
    // the github server block is untouched
    expect(result).toContain('command = "npx"')
    expect(changedLineNumbers(fixture, result)).toHaveLength(1)
  })

  it('is byte-identical outside the edited region', () => {
    const result = editTomlValue(fixture, ['approval_policy'], '"never"')
    const expected = fixture.replace(
      'approval_policy = "on-request"',
      'approval_policy = "never"'
    )
    expect(result).toBe(expected)
  })

  it('preserves comments and unknown sections verbatim', () => {
    const result = editTomlValue(fixture, ['model'], '"o3"')
    expect(result).toContain('# Hand-maintained ordering. Do not sort keys.')
    expect(result).toContain('undocumented_setting = "keep-me"')
    expect(result).toContain('# local files server')
  })

  it('throws TomlKeyNotFoundError for a missing key', () => {
    expect(() => editTomlValue(fixture, ['nonexistent'], '"x"')).toThrow(
      TomlKeyNotFoundError
    )
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./toml-edit`.

- [ ] **Step 5: Implement `src/main/fidelity/toml-edit.ts`**

```ts
import { parseTOML } from 'toml-eslint-parser'

// Minimal structural view of toml-eslint-parser AST nodes (only what we read).
interface TomlKeySegment {
  type: string
  name?: string
  value?: string | number
}

interface TomlAstNode {
  type: string
  range: [number, number]
  key?: { keys: TomlKeySegment[] }
  value?: { range: [number, number] }
  body?: TomlAstNode[]
}

export class TomlKeyNotFoundError extends Error {
  constructor(path: Array<string | number>) {
    super(`TOML key not found: ${path.join('.')}`)
    this.name = 'TomlKeyNotFoundError'
  }
}

function keySegments(key: { keys: TomlKeySegment[] }): string[] {
  return key.keys.map((segment) =>
    segment.type === 'TOMLBare' ? String(segment.name) : String(segment.value)
  )
}

function findValueRange(
  source: string,
  path: Array<string | number>
): [number, number] | null {
  const program = parseTOML(source) as unknown as { body: TomlAstNode[] }
  const topLevel = program.body[0]
  if (!topLevel?.body) return null
  const target = path.map(String).join(' ')

  let found: [number, number] | null = null
  const walk = (body: TomlAstNode[], prefix: string[]): void => {
    for (const node of body) {
      if (node.type === 'TOMLKeyValue' && node.key && node.value) {
        const full = [...prefix, ...keySegments(node.key)]
        if (full.join(' ') === target) found = node.value.range
      } else if (node.type === 'TOMLTable' && node.key && node.body) {
        // NOTE: array-of-tables ([[...]]) indexing is out of spike scope;
        // fixtures use standard tables only. Revisit in Milestone 3.
        walk(node.body, keySegments(node.key))
      }
    }
  }
  walk(topLevel.body, [])
  return found
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
  const range = findValueRange(source, path)
  if (!range) throw new TomlKeyNotFoundError(path)
  return source.slice(0, range[0]) + newValueToml + source.slice(range[1])
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS (5 tests).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/fidelity tests
git commit -m "feat: comment-preserving TOML value edits via span-splice (fidelity spike 1/3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Fidelity spike — surgical JSONC edits

**Files:**
- Create: `src/main/fidelity/jsonc-edit.ts`
- Create: `src/main/fidelity/jsonc-edit.test.ts`
- Create: `tests/fixtures/claude/settings.json`

**Interfaces:**
- Consumes: `changedLineNumbers` from `tests/helpers/diff.ts` (Task 2).
- Produces: `editJsonValue(source: string, path: Array<string | number>, value: unknown): string` from `src/main/fidelity/jsonc-edit.ts`.

- [ ] **Step 1: Write the fixture `tests/fixtures/claude/settings.json`**

```jsonc
{
  // User settings for Claude Code
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": ["Bash(bun run test:*)", "Read(~/.zshrc)"],
    "deny": ["WebFetch"]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "echo ran-bash" }]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "bun run lint" }]
      }
    ]
  },
  "unknownFutureSetting": { "keep": true },
  "env": { "CLAUDE_CODE_ENABLE_TELEMETRY": "0" }
}
```

- [ ] **Step 2: Write the failing tests `src/main/fidelity/jsonc-edit.test.ts`**

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changedLineNumbers } from '../../../tests/helpers/diff'
import { editJsonValue } from './jsonc-edit'

const fixture = readFileSync(
  join(import.meta.dirname, '../../../tests/fixtures/claude/settings.json'),
  'utf8'
)

describe('editJsonValue', () => {
  it('edits one hook command without touching the other hook', () => {
    const result = editJsonValue(
      fixture,
      ['hooks', 'PostToolUse', 1, 'hooks', 0, 'command'],
      'bun run lint --fix'
    )
    expect(result).toContain('"command": "bun run lint --fix"')
    expect(result).toContain('"command": "echo ran-bash"')
    expect(changedLineNumbers(fixture, result)).toHaveLength(1)
  })

  it('preserves comments and unknown fields', () => {
    const result = editJsonValue(fixture, ['env', 'CLAUDE_CODE_ENABLE_TELEMETRY'], '1')
    expect(result).toContain('// User settings for Claude Code')
    expect(result).toContain('"unknownFutureSetting": { "keep": true }')
  })

  it('is byte-identical outside the edited region', () => {
    const result = editJsonValue(
      fixture,
      ['env', 'CLAUDE_CODE_ENABLE_TELEMETRY'],
      '1'
    )
    const expected = fixture.replace(
      '"CLAUDE_CODE_ENABLE_TELEMETRY": "0"',
      '"CLAUDE_CODE_ENABLE_TELEMETRY": "1"'
    )
    expect(result).toBe(expected)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./jsonc-edit`.

- [ ] **Step 4: Implement `src/main/fidelity/jsonc-edit.ts`**

```ts
import { applyEdits, modify } from 'jsonc-parser'
import type { JSONPath } from 'jsonc-parser'

/**
 * Surgically set `value` at `path` in a JSON/JSONC document, preserving
 * comments, key order, and formatting everywhere else. This is the same
 * mechanism VS Code uses to edit settings.json.
 */
export function editJsonValue(
  source: string,
  path: JSONPath,
  value: unknown
): string {
  const edits = modify(source, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  })
  return applyEdits(source, edits)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS (Task 2's 5 tests + these 3).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/fidelity tests/fixtures/claude
git commit -m "feat: surgical JSONC edits preserving comments (fidelity spike 2/3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Fidelity spike — lossless form round trip for agent Markdown

**Files:**
- Create: `src/shared/resource.ts`
- Create: `src/main/fidelity/agent-markdown.ts`
- Create: `src/main/fidelity/agent-markdown.test.ts`
- Create: `tests/fixtures/claude/agents/code-reviewer.md`

**Interfaces:**
- Produces: from `src/shared/resource.ts`: `ProviderId`, `ResourceScope`, `Diagnostic`, `ResourceDocument`, `NativeResource`, `ResourceDraft`, `ResourceChange`, `FileOperation`, `FileOperationPlan`, `ValidationResult`, `DiscoveryContext` (consumed by Task 7's adapter contract). From `src/main/fidelity/agent-markdown.ts`: `AgentFormModel { name: string; description: string }`, `toFormModel(source: string): AgentFormModel`, `applyFormModel(source: string, model: AgentFormModel): string`.

- [ ] **Step 1: Write the fixture `tests/fixtures/claude/agents/code-reviewer.md`**

```markdown
---
# Reviewer agent definition
name: code-reviewer
description: Reviews pull requests for style issues
model: sonnet
tools: Read, Grep, Glob # keep minimal
custom_unknown_field:
  nested: true
---

You are a meticulous code reviewer.

## Process

1. Read the diff.
2. Comment on style violations only.
```

- [ ] **Step 2: Write `src/shared/resource.ts`** (normalized model per spec §11; aux types minimal for M1)

```ts
export type ProviderId = 'codex' | 'claude'
export type ResourceScope = 'user' | 'project' | 'directory'

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  path?: string
}

export interface ResourceDocument {
  id: string
  provider: ProviderId
  kind: string
  name: string
  description?: string
  scope: ResourceScope
  projectId?: string
  enabled: boolean | 'unsupported'
  sourcePaths: string[]
  fields: Record<string, unknown>
  native: {
    format: 'markdown' | 'json' | 'toml' | 'yaml' | 'directory' | 'unknown'
    raw?: string
    unknownFields?: Record<string, unknown>
  }
  diagnostics: Diagnostic[]
  modifiedAt: string
}

export interface NativeResource {
  provider: ProviderId
  kind: string
  scope: ResourceScope
  projectId?: string
  paths: string[]
}

export interface ResourceDraft {
  provider: ProviderId
  kind: string
  scope: ResourceScope
  projectId?: string
  fields: Record<string, unknown>
  raw?: string
}

export interface ResourceChange {
  kind: 'create' | 'update' | 'delete'
  resourceId?: string
  draft?: ResourceDraft
}

export interface FileOperation {
  kind: 'write' | 'move' | 'delete' | 'mkdir'
  path: string
  content?: string
  toPath?: string
}

export interface FileOperationPlan {
  operations: FileOperation[]
}

export interface ValidationResult {
  ok: boolean
  diagnostics: Diagnostic[]
}

export interface DiscoveryContext {
  projects: Array<{ id: string; path: string }>
}
```

- [ ] **Step 3: Write the failing tests `src/main/fidelity/agent-markdown.test.ts`**

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changedLineNumbers } from '../../../tests/helpers/diff'
import { applyFormModel, toFormModel } from './agent-markdown'

const fixture = readFileSync(
  join(import.meta.dirname, '../../../tests/fixtures/claude/agents/code-reviewer.md'),
  'utf8'
)

describe('agent markdown form round trip', () => {
  it('extracts known fields into the form model', () => {
    expect(toFormModel(fixture)).toEqual({
      name: 'code-reviewer',
      description: 'Reviews pull requests for style issues'
    })
  })

  it('returns the source byte-identical when nothing changed', () => {
    expect(applyFormModel(fixture, toFormModel(fixture))).toBe(fixture)
  })

  it('changes only the edited frontmatter line', () => {
    const result = applyFormModel(fixture, {
      name: 'code-reviewer',
      description: 'Reviews pull requests thoroughly'
    })
    expect(result).toContain('description: Reviews pull requests thoroughly')
    expect(changedLineNumbers(fixture, result)).toEqual([4])
  })

  it('preserves comments, unknown fields, and the body', () => {
    const result = applyFormModel(fixture, {
      name: 'code-reviewer',
      description: 'Reviews pull requests thoroughly'
    })
    expect(result).toContain('# Reviewer agent definition')
    expect(result).toContain('tools: Read, Grep, Glob # keep minimal')
    expect(result).toContain('custom_unknown_field:')
    expect(result).toContain('## Process')
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./agent-markdown`.

- [ ] **Step 5: Implement `src/main/fidelity/agent-markdown.ts`**

```ts
import { parseDocument } from 'yaml'

export interface AgentFormModel {
  name: string
  description: string
}

interface SplitDocument {
  frontmatter: string
  body: string
}

function split(source: string): SplitDocument {
  if (!source.startsWith('---\n')) {
    throw new Error('agent markdown must start with YAML frontmatter')
  }
  const end = source.indexOf('\n---\n', 3)
  if (end === -1) throw new Error('unterminated YAML frontmatter')
  return {
    frontmatter: source.slice(4, end + 1),
    body: source.slice(end + 5)
  }
}

function reassemble(parts: SplitDocument): string {
  return `---\n${parts.frontmatter}---\n${parts.body}`
}

export function toFormModel(source: string): AgentFormModel {
  const doc = parseDocument(split(source).frontmatter)
  return {
    name: String(doc.get('name') ?? ''),
    description: String(doc.get('description') ?? '')
  }
}

/**
 * Write form fields back into the frontmatter. Untouched fields, unknown
 * fields, comments, and the Markdown body are preserved. A no-op model
 * returns the source unchanged.
 */
export function applyFormModel(source: string, model: AgentFormModel): string {
  const parts = split(source)
  const doc = parseDocument(parts.frontmatter)
  let changed = false
  if (String(doc.get('name') ?? '') !== model.name) {
    doc.set('name', model.name)
    changed = true
  }
  if (String(doc.get('description') ?? '') !== model.description) {
    doc.set('description', model.description)
    changed = true
  }
  if (!changed) return source
  return reassemble({ frontmatter: String(doc), body: parts.body })
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS (all suites so far — 12 tests).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit** (this completes the spike — spec §18 exit criterion met)

```bash
git add src/shared src/main/fidelity tests/fixtures/claude/agents
git commit -m "feat: lossless form round trip for agent markdown (fidelity spike 3/3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Shared typed IPC contract

**Files:**
- Create: `src/shared/ipc.ts`
- Create: `src/shared/desktop-api.ts`
- Create: `src/shared/ipc.test.ts`

**Interfaces:**
- Consumes: `ProviderId` from `src/shared/resource.ts` (Task 4).
- Produces: from `src/shared/ipc.ts`: `providerIdSchema`, `providerStatusSchema` + `ProviderStatus`, `providerCapabilitiesSchema` + `ProviderCapabilities`, `resourceCategorySchema` + `ResourceCategory`, `projectSchema` + `Project`, `appErrorSchema` + `AppError`, `ipcContract`, `IpcChannel`, `IpcRequest<C>`, `IpcResponse<C>`, `IpcEnvelope<T>`. From `src/shared/desktop-api.ts`: `DesktopApi` interface (implemented by Task 9's preload, consumed by Task 10's renderer).

- [ ] **Step 1: Write the failing tests `src/shared/ipc.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { appErrorSchema, ipcContract, projectSchema } from './ipc'

describe('ipc contract schemas', () => {
  it('accepts a valid project', () => {
    const project = {
      id: 'b3e1c9a2-0000-4000-8000-000000000000',
      name: 'my-app',
      path: '/Users/example/my-app',
      addedAt: '2026-07-08T12:00:00.000Z'
    }
    expect(projectSchema.parse(project)).toEqual(project)
  })

  it('rejects a projects:remove request without an id', () => {
    const result = ipcContract['projects:remove'].request.safeParse({})
    expect(result.success).toBe(false)
  })

  it('accepts undefined payload for parameterless channels', () => {
    expect(ipcContract['providers:detect'].request.safeParse(undefined).success).toBe(true)
    expect(ipcContract['projects:list'].request.safeParse(undefined).success).toBe(true)
  })

  it('requires the actionable-error fields from spec section 16', () => {
    const error = {
      code: 'conflict',
      operation: 'projects:add',
      message: 'Project already registered',
      changed: false
    }
    expect(appErrorSchema.parse(error)).toEqual(error)
    expect(appErrorSchema.safeParse({ message: 'x' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./ipc`.

- [ ] **Step 3: Implement `src/shared/ipc.ts`**

```ts
import { z } from 'zod'

export const providerIdSchema = z.enum(['codex', 'claude'])

export const providerStatusSchema = z.object({
  id: providerIdSchema,
  displayName: z.string(),
  detected: z.boolean(),
  configRoot: z.string().nullable()
})
export type ProviderStatus = z.infer<typeof providerStatusSchema>

export const resourceCategorySchema = z.object({
  id: z.string(),
  label: z.string()
})
export type ResourceCategory = z.infer<typeof resourceCategorySchema>

export const providerCapabilitiesSchema = z.object({
  providerId: providerIdSchema,
  displayName: z.string(),
  categories: z.array(resourceCategorySchema)
})
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  addedAt: z.string()
})
export type Project = z.infer<typeof projectSchema>

// Actionable error shape per spec section 16.
export const appErrorSchema = z.object({
  code: z.enum([
    'invalid-request',
    'not-implemented',
    'conflict',
    'not-found',
    'permission',
    'io',
    'internal'
  ]),
  operation: z.string(),
  message: z.string(),
  path: z.string().optional(),
  changed: z.boolean(),
  recovery: z.string().optional()
})
export type AppError = z.infer<typeof appErrorSchema>

export const ipcContract = {
  'providers:detect': {
    request: z.undefined(),
    response: z.array(providerStatusSchema)
  },
  'providers:capabilities': {
    request: z.undefined(),
    response: z.array(providerCapabilitiesSchema)
  },
  'projects:add': {
    request: z.undefined(),
    response: projectSchema.nullable()
  },
  'projects:list': {
    request: z.undefined(),
    response: z.array(projectSchema)
  },
  'projects:remove': {
    request: z.object({ id: z.string() }),
    response: z.undefined()
  }
} as const

export type IpcChannel = keyof typeof ipcContract
export type IpcRequest<C extends IpcChannel> = z.infer<
  (typeof ipcContract)[C]['request']
>
export type IpcResponse<C extends IpcChannel> = z.infer<
  (typeof ipcContract)[C]['response']
>

export type IpcEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }
```

- [ ] **Step 4: Implement `src/shared/desktop-api.ts`**

```ts
import type { Project, ProviderCapabilities, ProviderStatus } from './ipc'

/**
 * The complete surface the preload exposes to the renderer. No generic
 * filesystem access is ever added here (spec section 10.2).
 */
export interface DesktopApi {
  providers: {
    detect(): Promise<ProviderStatus[]>
    capabilities(): Promise<ProviderCapabilities[]>
  }
  projects: {
    add(): Promise<Project | null>
    list(): Promise<Project[]>
    remove(id: string): Promise<void>
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared
git commit -m "feat: shared typed IPC contract with zod validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: SQLite database and ProjectsStore

**Files:**
- Create: `src/main/errors.ts`
- Create: `src/main/services/db.ts`
- Create: `src/main/services/projects-store.ts`
- Create: `src/main/services/projects-store.test.ts`

**Interfaces:**
- Consumes: `Project`, `AppError` from `src/shared/ipc.ts` (Task 5).
- Produces: `AppOperationError` (with `.code`, `.operation`, `.toAppError(): AppError`) and `toAppError(operation: string, error: unknown): AppError` from `src/main/errors.ts`; `openDatabase(location: string): DatabaseSync` from `src/main/services/db.ts`; `class ProjectsStore { constructor(db: DatabaseSync); add(rawPath: string): Project; list(): Project[]; remove(id: string): void }` from `src/main/services/projects-store.ts`. Consumed by Task 8's handlers.

- [ ] **Step 1: Write `src/main/errors.ts`**

```ts
import type { AppError } from '../shared/ipc'

interface AppOperationErrorOptions {
  path?: string
  changed?: boolean
  recovery?: string
}

export class AppOperationError extends Error {
  constructor(
    readonly code: AppError['code'],
    readonly operation: string,
    message: string,
    private readonly options: AppOperationErrorOptions = {}
  ) {
    super(message)
    this.name = 'AppOperationError'
  }

  toAppError(): AppError {
    return {
      code: this.code,
      operation: this.operation,
      message: this.message,
      path: this.options.path,
      changed: this.options.changed ?? false,
      recovery: this.options.recovery
    }
  }
}

export function toAppError(operation: string, error: unknown): AppError {
  if (error instanceof AppOperationError) return error.toAppError()
  return {
    code: 'internal',
    operation,
    message: error instanceof Error ? error.message : String(error),
    changed: false
  }
}
```

- [ ] **Step 2: Write the failing tests `src/main/services/projects-store.test.ts`**

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { openDatabase } from './db'
import { ProjectsStore } from './projects-store'

let projectDir: string
let store: ProjectsStore

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'agent-control-test-'))
  store = new ProjectsStore(openDatabase(':memory:'))
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe('ProjectsStore', () => {
  it('adds a project and derives its name from the directory', () => {
    const project = store.add(projectDir)
    expect(project.path).toBe(projectDir)
    expect(project.name).toBe(projectDir.split('/').at(-1))
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(new Date(project.addedAt).getTime()).not.toBeNaN()
  })

  it('lists added projects', () => {
    const project = store.add(projectDir)
    expect(store.list()).toEqual([project])
  })

  it('removes a project by id', () => {
    const project = store.add(projectDir)
    store.remove(project.id)
    expect(store.list()).toEqual([])
  })

  it('rejects a duplicate path with a conflict error', () => {
    store.add(projectDir)
    expect(() => store.add(projectDir)).toThrowError(AppOperationError)
    try {
      store.add(projectDir)
    } catch (error) {
      expect((error as AppOperationError).code).toBe('conflict')
    }
  })

  it('rejects a path that is not an existing directory', () => {
    try {
      store.add(join(projectDir, 'does-not-exist'))
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('not-found')
    }
  })

  it('rejects relative paths', () => {
    try {
      store.add('some/relative/path')
      expect.unreachable()
    } catch (error) {
      expect((error as AppOperationError).code).toBe('invalid-request')
    }
  })

  it('persists across database reopen', () => {
    const dbPath = join(projectDir, 'meta.db')
    const first = new ProjectsStore(openDatabase(dbPath))
    const project = first.add(projectDir)
    const second = new ProjectsStore(openDatabase(dbPath))
    expect(second.list()).toEqual([project])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./db` / `./projects-store`.

- [ ] **Step 4: Implement `src/main/services/db.ts`**

```ts
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL
  );`
]

export function openDatabase(location: string): DatabaseSync {
  const db = new DatabaseSync(location)
  db.exec('PRAGMA foreign_keys = ON;')
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec(MIGRATIONS[version])
    db.exec(`PRAGMA user_version = ${version + 1}`)
  }
  return db
}
```

- [ ] **Step 5: Implement `src/main/services/projects-store.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Project } from '../../shared/ipc'
import { AppOperationError } from '../errors'

interface ProjectRow {
  id: string
  name: string
  path: string
  added_at: string
}

function toProject(row: ProjectRow): Project {
  return { id: row.id, name: row.name, path: row.path, addedAt: row.added_at }
}

export class ProjectsStore {
  constructor(private readonly db: DatabaseSync) {}

  add(rawPath: string): Project {
    if (!isAbsolute(rawPath)) {
      throw new AppOperationError(
        'invalid-request',
        'projects:add',
        `Project path must be absolute: ${rawPath}`
      )
    }
    const path = resolve(rawPath)

    let isDirectory = false
    try {
      isDirectory = statSync(path).isDirectory()
    } catch {
      isDirectory = false
    }
    if (!isDirectory) {
      throw new AppOperationError(
        'not-found',
        'projects:add',
        `Not an existing directory: ${path}`,
        { path }
      )
    }

    const existing = this.db
      .prepare('SELECT id FROM projects WHERE path = ?')
      .get(path)
    if (existing) {
      throw new AppOperationError(
        'conflict',
        'projects:add',
        `Project already registered: ${path}`,
        { path, recovery: 'Remove the existing registration first.' }
      )
    }

    const project: Project = {
      id: randomUUID(),
      name: basename(path),
      path,
      addedAt: new Date().toISOString()
    }
    this.db
      .prepare('INSERT INTO projects (id, name, path, added_at) VALUES (?, ?, ?, ?)')
      .run(project.id, project.name, project.path, project.addedAt)
    return project
  }

  list(): Project[] {
    const rows = this.db
      .prepare('SELECT id, name, path, added_at FROM projects ORDER BY added_at')
      .all() as unknown as ProjectRow[]
    return rows.map(toProject)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS (all suites).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/errors.ts src/main/services
git commit -m "feat: sqlite-backed project registration store

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Provider adapter interface, stub adapters, registry

**Files:**
- Create: `src/main/providers/types.ts`
- Create: `src/main/providers/codex.ts`
- Create: `src/main/providers/claude.ts`
- Create: `src/main/providers/registry.ts`
- Create: `src/main/providers/adapters.test.ts`

**Interfaces:**
- Consumes: resource types from `src/shared/resource.ts` (Task 4); `ProviderStatus`, `ProviderCapabilities` from `src/shared/ipc.ts` (Task 5); `AppOperationError` from `src/main/errors.ts` (Task 6).
- Produces: `ProviderAdapter` interface (spec §10.4) from `src/main/providers/types.ts`; `createCodexAdapter(options?: { configRoot?: string }): ProviderAdapter`; `createClaudeAdapter(options?: { configRoot?: string }): ProviderAdapter`; `class ProviderRegistry { register(adapter): void; all(): ProviderAdapter[]; get(id: ProviderId): ProviderAdapter }` and `createDefaultRegistry(): ProviderRegistry` from `src/main/providers/registry.ts`. Consumed by Task 8's handlers.

- [ ] **Step 1: Write `src/main/providers/types.ts`**

```ts
import type { ProviderCapabilities, ProviderStatus } from '../../shared/ipc'
import type {
  DiscoveryContext,
  NativeResource,
  ProviderId,
  ResourceChange,
  ResourceDocument,
  ResourceDraft,
  FileOperationPlan,
  ValidationResult
} from '../../shared/resource'

// Provider adapter contract per spec section 10.4.
export interface ProviderAdapter {
  readonly id: ProviderId
  detect(): Promise<ProviderStatus>
  capabilities(): ProviderCapabilities
  discover(context: DiscoveryContext): Promise<NativeResource[]>
  parse(source: NativeResource): Promise<ResourceDocument>
  validate(draft: ResourceDraft): Promise<ValidationResult>
  plan(change: ResourceChange): Promise<FileOperationPlan>
}
```

- [ ] **Step 2: Write the failing tests `src/main/providers/adapters.test.ts`**

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { createClaudeAdapter } from './claude'
import { createCodexAdapter } from './codex'
import { ProviderRegistry, createDefaultRegistry } from './registry'

let existingRoot: string

beforeEach(() => {
  existingRoot = mkdtempSync(join(tmpdir(), 'agent-control-provider-'))
})

afterEach(() => {
  rmSync(existingRoot, { recursive: true, force: true })
})

describe('provider adapters', () => {
  it('detects a provider when its config root exists', async () => {
    const adapter = createCodexAdapter({ configRoot: existingRoot })
    expect(await adapter.detect()).toEqual({
      id: 'codex',
      displayName: 'Codex',
      detected: true,
      configRoot: existingRoot
    })
  })

  it('reports not detected when the config root is missing', async () => {
    const missing = join(existingRoot, 'nope')
    const adapter = createClaudeAdapter({ configRoot: missing })
    expect(await adapter.detect()).toEqual({
      id: 'claude',
      displayName: 'Claude Code',
      detected: false,
      configRoot: null
    })
  })

  it('exposes provider-honest categories (commands are Claude-only)', () => {
    const codexCategories = createCodexAdapter().capabilities().categories
    const claudeCategories = createClaudeAdapter().capabilities().categories
    expect(codexCategories.map((c) => c.id)).not.toContain('commands')
    expect(claudeCategories.map((c) => c.id)).toContain('commands')
    for (const categories of [codexCategories, claudeCategories]) {
      expect(categories.map((c) => c.id)).toEqual(
        expect.arrayContaining(['agents', 'skills', 'plugins', 'hooks', 'mcp-servers', 'instructions'])
      )
    }
  })

  it('throws not-implemented for milestone 2+ operations', async () => {
    const adapter = createCodexAdapter()
    await expect(adapter.discover({ projects: [] })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppOperationError && error.code === 'not-implemented'
    )
  })
})

describe('ProviderRegistry', () => {
  it('registers and retrieves adapters by id', () => {
    const registry = new ProviderRegistry()
    const codex = createCodexAdapter()
    registry.register(codex)
    expect(registry.get('codex')).toBe(codex)
    expect(registry.all()).toEqual([codex])
  })

  it('default registry contains codex and claude', () => {
    const registry = createDefaultRegistry()
    expect(registry.all().map((a) => a.id)).toEqual(['codex', 'claude'])
  })

  it('throws for an unknown provider id', () => {
    expect(() => new ProviderRegistry().get('codex')).toThrowError(AppOperationError)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./codex` / `./claude` / `./registry`.

- [ ] **Step 4: Implement `src/main/providers/codex.ts`**

```ts
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AppOperationError } from '../errors'
import type { ProviderAdapter } from './types'

export interface AdapterOptions {
  configRoot?: string
}

function notImplemented(operation: string): never {
  throw new AppOperationError(
    'not-implemented',
    operation,
    'Resource discovery and editing arrive in Milestone 2/3.'
  )
}

export function createCodexAdapter(options: AdapterOptions = {}): ProviderAdapter {
  const configRoot = options.configRoot ?? join(homedir(), '.codex')
  return {
    id: 'codex',
    async detect() {
      const detected = existsSync(configRoot)
      return {
        id: 'codex',
        displayName: 'Codex',
        detected,
        configRoot: detected ? configRoot : null
      }
    },
    capabilities() {
      return {
        providerId: 'codex',
        displayName: 'Codex',
        categories: [
          { id: 'agents', label: 'Agents' },
          { id: 'skills', label: 'Skills' },
          { id: 'plugins', label: 'Plugins' },
          { id: 'hooks', label: 'Hooks' },
          { id: 'mcp-servers', label: 'MCP Servers' },
          { id: 'instructions', label: 'Instructions' }
        ]
      }
    },
    async discover() {
      return notImplemented('codex:discover')
    },
    async parse() {
      return notImplemented('codex:parse')
    },
    async validate() {
      return notImplemented('codex:validate')
    },
    async plan() {
      return notImplemented('codex:plan')
    }
  }
}
```

- [ ] **Step 5: Implement `src/main/providers/claude.ts`**

```ts
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AppOperationError } from '../errors'
import type { AdapterOptions } from './codex'
import type { ProviderAdapter } from './types'

function notImplemented(operation: string): never {
  throw new AppOperationError(
    'not-implemented',
    operation,
    'Resource discovery and editing arrive in Milestone 2/3.'
  )
}

export function createClaudeAdapter(options: AdapterOptions = {}): ProviderAdapter {
  const configRoot = options.configRoot ?? join(homedir(), '.claude')
  return {
    id: 'claude',
    async detect() {
      const detected = existsSync(configRoot)
      return {
        id: 'claude',
        displayName: 'Claude Code',
        detected,
        configRoot: detected ? configRoot : null
      }
    },
    capabilities() {
      return {
        providerId: 'claude',
        displayName: 'Claude Code',
        categories: [
          { id: 'agents', label: 'Agents' },
          { id: 'skills', label: 'Skills' },
          { id: 'plugins', label: 'Plugins' },
          { id: 'commands', label: 'Commands' },
          { id: 'hooks', label: 'Hooks' },
          { id: 'mcp-servers', label: 'MCP Servers' },
          { id: 'instructions', label: 'Instructions' }
        ]
      }
    },
    async discover() {
      return notImplemented('claude:discover')
    },
    async parse() {
      return notImplemented('claude:parse')
    },
    async validate() {
      return notImplemented('claude:validate')
    },
    async plan() {
      return notImplemented('claude:plan')
    }
  }
}
```

- [ ] **Step 6: Implement `src/main/providers/registry.ts`**

```ts
import type { ProviderId } from '../../shared/resource'
import { AppOperationError } from '../errors'
import { createClaudeAdapter } from './claude'
import { createCodexAdapter } from './codex'
import type { ProviderAdapter } from './types'

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>()

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  all(): ProviderAdapter[] {
    return [...this.adapters.values()]
  }

  get(id: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      throw new AppOperationError(
        'not-found',
        'providers:get',
        `No adapter registered for provider: ${id}`
      )
    }
    return adapter
  }
}

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register(createCodexAdapter())
  registry.register(createClaudeAdapter())
  return registry
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS (all suites).

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/main/providers
git commit -m "feat: provider adapter contract with codex/claude stub adapters

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Main-process wiring — security policy + validated IPC handlers

**Files:**
- Create: `src/main/ipc/trust.ts`
- Create: `src/main/ipc/trust.test.ts`
- Create: `src/main/ipc/handlers.ts`
- Create: `src/main/security.ts`
- Modify: `src/main/index.ts` (replace Task 1's version entirely with the code below)

**Interfaces:**
- Consumes: `ipcContract`, `IpcChannel`, `IpcRequest`, `IpcResponse`, `IpcEnvelope` (Task 5); `toAppError` (Task 6); `ProjectsStore` (Task 6); `ProviderRegistry`, `createDefaultRegistry` (Task 7).
- Produces: `isTrustedUrl(url: string, devServerUrl: string | undefined): boolean`; `registerIpcHandlers(deps: { projects: ProjectsStore; registry: ProviderRegistry; pickDirectory(): Promise<string | null> }): void`; `applySecurityPolicy(devServerUrl: string | undefined): void`. The IPC channels become live for Task 9's preload.

- [ ] **Step 1: Write the failing tests `src/main/ipc/trust.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { isTrustedUrl } from './trust'

describe('isTrustedUrl', () => {
  it('trusts file:// urls (packaged renderer)', () => {
    expect(isTrustedUrl('file:///Applications/Agent%20Control.app/renderer/index.html', undefined)).toBe(true)
  })

  it('trusts the dev server origin when provided', () => {
    expect(isTrustedUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
  })

  it('rejects other http origins', () => {
    expect(isTrustedUrl('http://evil.example.com/', 'http://localhost:5173')).toBe(false)
    expect(isTrustedUrl('http://localhost:5173/', undefined)).toBe(false)
  })

  it('rejects arbitrary schemes and empty urls', () => {
    expect(isTrustedUrl('javascript:alert(1)', undefined)).toBe(false)
    expect(isTrustedUrl('', 'http://localhost:5173')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `./trust`.

- [ ] **Step 3: Implement `src/main/ipc/trust.ts`**

```ts
export function isTrustedUrl(
  url: string,
  devServerUrl: string | undefined
): boolean {
  if (url.startsWith('file://')) return true
  if (devServerUrl && url.startsWith(devServerUrl)) return true
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 5: Implement `src/main/ipc/handlers.ts`**

```ts
import { ipcMain } from 'electron'
import {
  ipcContract,
  type IpcChannel,
  type IpcEnvelope,
  type IpcRequest,
  type IpcResponse
} from '../../shared/ipc'
import { toAppError } from '../errors'
import type { ProviderRegistry } from '../providers/registry'
import type { ProjectsStore } from '../services/projects-store'
import { isTrustedUrl } from './trust'

export interface HandlerDeps {
  projects: ProjectsStore
  registry: ProviderRegistry
  pickDirectory(): Promise<string | null>
}

function handle<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>) => Promise<IpcResponse<C>> | IpcResponse<C>
): void {
  ipcMain.handle(
    channel,
    async (event, payload: unknown): Promise<IpcEnvelope<IpcResponse<C>>> => {
      const senderUrl = event.senderFrame?.url ?? ''
      if (!isTrustedUrl(senderUrl, process.env['ELECTRON_RENDERER_URL'])) {
        return {
          ok: false,
          error: {
            code: 'permission',
            operation: channel,
            message: `Rejected IPC from untrusted sender: ${senderUrl || '(unknown)'}`,
            changed: false
          }
        }
      }
      const parsed = ipcContract[channel].request.safeParse(payload)
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'invalid-request',
            operation: channel,
            message: parsed.error.issues.map((issue) => issue.message).join('; '),
            changed: false
          }
        }
      }
      try {
        const data = await handler(parsed.data as IpcRequest<C>)
        return { ok: true, data }
      } catch (error) {
        return { ok: false, error: toAppError(channel, error) }
      }
    }
  )
}

export function registerIpcHandlers(deps: HandlerDeps): void {
  handle('providers:detect', async () =>
    Promise.all(deps.registry.all().map((adapter) => adapter.detect()))
  )
  handle('providers:capabilities', () =>
    deps.registry.all().map((adapter) => adapter.capabilities())
  )
  handle('projects:add', async () => {
    const directory = await deps.pickDirectory()
    return directory === null ? null : deps.projects.add(directory)
  })
  handle('projects:list', () => deps.projects.list())
  handle('projects:remove', (request) => {
    deps.projects.remove(request.id)
    return undefined
  })
}
```

- [ ] **Step 6: Implement `src/main/security.ts`**

```ts
import { app } from 'electron'
import { isTrustedUrl } from './ipc/trust'

/**
 * Global hardening per spec section 14: deny window creation, block
 * navigation to untrusted origins, and refuse webview attachment for every
 * WebContents the app ever creates. Call before app ready.
 */
export function applySecurityPolicy(devServerUrl: string | undefined): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url, devServerUrl)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}
```

- [ ] **Step 7: Replace `src/main/index.ts`**

```ts
import { join } from 'node:path'
import { BrowserWindow, app, dialog } from 'electron'
import { registerIpcHandlers } from './ipc/handlers'
import { createDefaultRegistry } from './providers/registry'
import { openDatabase } from './services/db'
import { ProjectsStore } from './services/projects-store'
import { applySecurityPolicy } from './security'

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

applySecurityPolicy(DEV_SERVER_URL)

void app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath('userData'), 'agent-control.db'))
  registerIpcHandlers({
    projects: new ProjectsStore(db),
    registry: createDefaultRegistry(),
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog({
        title: 'Add project',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled || result.filePaths.length === 0
        ? null
        : result.filePaths[0]
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 8: Verify**

Run: `bun run test`
Expected: PASS (all suites).

Run: `bun run typecheck`
Expected: exit 0. (Note: `handlers.ts` indexes `ipcContract[channel].request` under a generic — if tsc reports the safeParse call on the union, cast the schema first: `const requestSchema: z.ZodType<unknown> = ipcContract[channel].request` and parse with that; keep the `parsed.data as IpcRequest<C>` cast.)

- [ ] **Step 9: Commit**

```bash
git add src/main
git commit -m "feat: security policy and zod-validated IPC handlers in main process

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Preload DesktopApi

**Files:**
- Modify: `src/preload/index.ts` (replace placeholder)
- Modify: `src/renderer/src/env.d.ts` (add the global declaration)

**Interfaces:**
- Consumes: `DesktopApi` (Task 5), `IpcChannel`/`IpcRequest`/`IpcResponse`/`IpcEnvelope` types (Task 5), live channels (Task 8).
- Produces: `window.desktopApi: DesktopApi` in the renderer, typed globally via `env.d.ts`.

- [ ] **Step 1: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/desktop-api'
import type {
  IpcChannel,
  IpcEnvelope,
  IpcRequest,
  IpcResponse
} from '../shared/ipc'

// Type-only imports keep the sandboxed preload bundle dependency-free.

async function invoke<C extends IpcChannel>(
  channel: C,
  payload?: IpcRequest<C>
): Promise<IpcResponse<C>> {
  const envelope = (await ipcRenderer.invoke(channel, payload)) as IpcEnvelope<
    IpcResponse<C>
  >
  if (!envelope.ok) {
    throw new Error(`${envelope.error.operation}: ${envelope.error.message}`)
  }
  return envelope.data
}

const api: DesktopApi = {
  providers: {
    detect: () => invoke('providers:detect'),
    capabilities: () => invoke('providers:capabilities')
  },
  projects: {
    add: () => invoke('projects:add'),
    list: () => invoke('projects:list'),
    remove: async (id) => {
      await invoke('projects:remove', { id })
    }
  }
}

contextBridge.exposeInMainWorld('desktopApi', api)
```

- [ ] **Step 2: Replace `src/renderer/src/env.d.ts`**

```ts
/// <reference types="vite/client" />

import type { DesktopApi } from '@shared/desktop-api'

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}

export {}
```

- [ ] **Step 3: Verify**

Run: `bun run typecheck`
Expected: exit 0.

Run: `bun run test`
Expected: PASS (unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/preload src/renderer/src/env.d.ts
git commit -m "feat: expose typed DesktopApi through sandboxed preload

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Renderer — three-column shell, Overview, Projects, theming

> **Implementer note:** this is the milestone's only user-facing surface. Invoke the `frontend-design:frontend-design` skill before writing the UI, and keep the visual language calm and settings-app-like (spec §8.1). The code below is the required structure and behavior; refine visual polish within it.

**Files:**
- Modify: `src/renderer/src/assets/main.css` (replace placeholder)
- Create: `src/renderer/src/lib/utils.ts`
- Create: `src/renderer/src/lib/theme.tsx`
- Create: `src/renderer/src/components/ui/button.tsx`
- Create: `src/renderer/src/components/EmptyState.tsx`
- Create: `src/renderer/src/components/NavSidebar.tsx`
- Create: `src/renderer/src/navigation.ts`
- Create: `src/renderer/src/screens/OverviewScreen.tsx`
- Create: `src/renderer/src/screens/ProjectsScreen.tsx`
- Create: `src/renderer/src/screens/SettingsScreen.tsx`
- Modify: `src/renderer/src/App.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `window.desktopApi` (Task 9); `ProviderCapabilities`, `ProviderStatus`, `Project` types from `@shared/ipc`.
- Produces: the complete M1 shell. Nav keys: `overview`, `projects`, `backups`, `settings`, and `provider/<providerId>/<categoryId>` for adapter categories.

- [ ] **Step 1: Replace `src/renderer/src/assets/main.css`**

```css
@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: oklch(0.985 0.002 250);
  --foreground: oklch(0.24 0.02 260);
  --card: oklch(1 0 0);
  --muted: oklch(0.955 0.004 250);
  --muted-foreground: oklch(0.52 0.015 260);
  --border: oklch(0.9 0.008 250);
  --accent: oklch(0.94 0.01 250);
  --primary: oklch(0.52 0.15 262);
  --primary-foreground: oklch(0.985 0.002 250);
  --destructive: oklch(0.55 0.19 25);
}

.dark {
  --background: oklch(0.21 0.012 260);
  --foreground: oklch(0.93 0.005 250);
  --card: oklch(0.25 0.012 260);
  --muted: oklch(0.27 0.012 260);
  --muted-foreground: oklch(0.68 0.012 255);
  --border: oklch(0.32 0.012 260);
  --accent: oklch(0.3 0.015 260);
  --primary: oklch(0.68 0.13 262);
  --primary-foreground: oklch(0.17 0.012 260);
  --destructive: oklch(0.66 0.17 25);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-accent: var(--accent);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-destructive: var(--destructive);
}

body {
  @apply bg-background text-foreground antialiased;
}
```

- [ ] **Step 2: Write `src/renderer/src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 3: Write `src/renderer/src/lib/theme.tsx`**

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react'

export type Theme = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: Theme
  setTheme(theme: Theme): void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => undefined
})

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('agent-control-theme')
    return isTheme(stored) ? stored : 'system'
  })

  useEffect(() => {
    localStorage.setItem('agent-control-theme', theme)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
```

- [ ] **Step 4: Write `src/renderer/src/components/ui/button.tsx`**

```tsx
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const variants = {
  default:
    'bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-primary',
  outline:
    'border border-border bg-transparent hover:bg-accent focus-visible:outline-primary',
  ghost: 'hover:bg-accent focus-visible:outline-primary',
  destructive:
    'border border-destructive/40 text-destructive hover:bg-destructive/10 focus-visible:outline-destructive'
} as const

export type ButtonVariant = keyof typeof variants

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({
  variant = 'default',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium',
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
```

- [ ] **Step 5: Write `src/renderer/src/components/EmptyState.tsx`**

```tsx
interface EmptyStateProps {
  title: string
  description: string
  milestone?: string
}

export function EmptyState({ title, description, milestone }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {milestone ? (
        <span className="mt-2 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
          Planned for {milestone}
        </span>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 6: Write `src/renderer/src/navigation.ts`**

```ts
import type { ProviderCapabilities } from '@shared/ipc'

export interface NavItem {
  key: string
  label: string
}

export interface NavSection {
  key: string
  label: string | null
  items: NavItem[]
}

/**
 * Build the sidebar from adapter capabilities. Provider categories are data,
 * never hard-coded here (spec section 8.2).
 */
export function buildNavSections(capabilities: ProviderCapabilities[]): NavSection[] {
  return [
    { key: 'general', label: null, items: [{ key: 'overview', label: 'Overview' }] },
    ...capabilities.map((provider) => ({
      key: `provider/${provider.providerId}`,
      label: provider.displayName,
      items: provider.categories.map((category) => ({
        key: `provider/${provider.providerId}/${category.id}`,
        label: category.label
      }))
    })),
    {
      key: 'app',
      label: null,
      items: [
        { key: 'projects', label: 'Projects' },
        { key: 'backups', label: 'Backups' },
        { key: 'settings', label: 'Settings' }
      ]
    }
  ]
}
```

- [ ] **Step 7: Write `src/renderer/src/components/NavSidebar.tsx`**

```tsx
import type { ProviderCapabilities } from '@shared/ipc'
import { cn } from '../lib/utils'
import { buildNavSections } from '../navigation'

interface NavSidebarProps {
  capabilities: ProviderCapabilities[]
  selected: string
  onSelect(key: string): void
}

export function NavSidebar({ capabilities, selected, onSelect }: NavSidebarProps) {
  const sections = buildNavSections(capabilities)
  return (
    <nav
      aria-label="Main navigation"
      className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-muted/40 p-3"
    >
      <div className="px-2 pt-1 text-sm font-semibold tracking-tight">Agent Control</div>
      {sections.map((section) => (
        <div key={section.key}>
          {section.label ? (
            <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {section.label}
            </div>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  aria-current={selected === item.key ? 'page' : undefined}
                  onClick={() => onSelect(item.key)}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
                    selected === item.key
                      ? 'bg-accent font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
```

- [ ] **Step 8: Write `src/renderer/src/screens/OverviewScreen.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { ProviderStatus } from '@shared/ipc'

export function OverviewScreen() {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.desktopApi.providers
      .detect()
      .then(setProviders)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause))
      )
  }, [])

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Installed providers detected on this machine.
      </p>
      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      <div className="mt-5 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {(providers ?? []).map((provider) => (
          <div key={provider.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">{provider.displayName}</span>
              <span
                className={
                  provider.detected
                    ? 'rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
                    : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                }
              >
                {provider.detected ? 'Detected' : 'Not detected'}
              </span>
            </div>
            <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
              {provider.configRoot ?? 'No configuration directory found'}
            </p>
          </div>
        ))}
        {providers === null && !error ? (
          <p className="text-sm text-muted-foreground">Detecting providers…</p>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 9: Write `src/renderer/src/screens/ProjectsScreen.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@shared/ipc'
import { Button } from '../components/ui/button'

export function ProjectsScreen() {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    window.desktopApi.projects
      .list()
      .then(setProjects)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause))
      )
  }, [])

  useEffect(refresh, [refresh])

  const addProject = async (): Promise<void> => {
    setError(null)
    try {
      const added = await window.desktopApi.projects.add()
      if (added) refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const removeProject = async (project: Project): Promise<void> => {
    if (!window.confirm(`Remove project "${project.name}" from Agent Control? Files on disk are not touched.`)) {
      return
    }
    setError(null)
    try {
      await window.desktopApi.projects.remove(project.id)
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registered folders scanned for project-scoped resources.
          </p>
        </div>
        <Button onClick={() => void addProject()}>Add project</Button>
      </div>
      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      <ul className="mt-5 flex max-w-2xl flex-col gap-2">
        {projects.map((project) => (
          <li
            key={project.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{project.name}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{project.path}</div>
            </div>
            <Button variant="destructive" onClick={() => void removeProject(project)}>
              Remove
            </Button>
          </li>
        ))}
        {projects.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No projects registered yet. Add a project folder to manage its resources.
          </li>
        ) : null}
      </ul>
    </div>
  )
}
```

- [ ] **Step 10: Write `src/renderer/src/screens/SettingsScreen.tsx`**

```tsx
import { useTheme, type Theme } from '../lib/theme'
import { cn } from '../lib/utils'

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

export function SettingsScreen() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <div className="mt-5 max-w-md rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium">Appearance</div>
        <div role="radiogroup" aria-label="Theme" className="mt-3 flex gap-2">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              onClick={() => setTheme(option.value)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                theme === option.value
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 11: Replace `src/renderer/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { ProviderCapabilities } from '@shared/ipc'
import { EmptyState } from './components/EmptyState'
import { NavSidebar } from './components/NavSidebar'
import { ThemeProvider } from './lib/theme'
import { OverviewScreen } from './screens/OverviewScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { SettingsScreen } from './screens/SettingsScreen'

function Screen({ selected, capabilities }: { selected: string; capabilities: ProviderCapabilities[] }) {
  if (selected === 'overview') return <OverviewScreen />
  if (selected === 'projects') return <ProjectsScreen />
  if (selected === 'settings') return <SettingsScreen />
  if (selected === 'backups') {
    return (
      <EmptyState
        title="Backups"
        description="Every change Agent Control makes will create a restorable backup here."
        milestone="Milestone 3"
      />
    )
  }
  if (selected.startsWith('provider/')) {
    const [, providerId, categoryId] = selected.split('/')
    const provider = capabilities.find((c) => c.providerId === providerId)
    const category = provider?.categories.find((c) => c.id === categoryId)
    return (
      <EmptyState
        title={`${provider?.displayName ?? ''} ${category?.label ?? ''}`.trim()}
        description="Read-only discovery of this resource type is the next milestone."
        milestone="Milestone 2"
      />
    )
  }
  return <EmptyState title="Not found" description="Unknown navigation target." />
}

export default function App() {
  const [selected, setSelected] = useState('overview')
  const [capabilities, setCapabilities] = useState<ProviderCapabilities[]>([])

  useEffect(() => {
    window.desktopApi.providers
      .capabilities()
      .then(setCapabilities)
      .catch(() => setCapabilities([]))
  }, [])

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden">
        <NavSidebar capabilities={capabilities} selected={selected} onSelect={setSelected} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Screen selected={selected} capabilities={capabilities} />
        </main>
      </div>
    </ThemeProvider>
  )
}
```

- [ ] **Step 12: Verify**

Run: `bun run typecheck`
Expected: exit 0.

Run: `bun run test`
Expected: PASS (unchanged suites).

- [ ] **Step 13: Commit**

```bash
git add src/renderer
git commit -m "feat: three-column app shell with overview, projects, and theming

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Final verification — full check plus one authorized build & launch

**Files:** none created; this task only verifies.

- [ ] **Step 1: Full test and typecheck run**

Run: `bun run typecheck && bun run test`
Expected: both exit 0; all suites pass (TOML spike 5, JSONC spike 3, form round trip 4, IPC contract 4, projects store 7, adapters 7, trust 4 — 34 tests).

- [ ] **Step 2: Build (explicitly authorized for this step only)**

Run: `bun run build`
Expected: exit 0; `out/main/index.js`, `out/preload/index.cjs`, and `out/renderer/index.html` exist. If the preload file is emitted with a different extension (e.g. `index.js`), update the `preload:` path in `src/main/index.ts` to match, re-run the build, and commit the fix.

- [ ] **Step 3: Launch smoke test**

Run: `bun run start` in the background; wait ~10 seconds; confirm the process is still alive and no crash/uncaught-exception output appeared; then terminate it.
Expected: app window opens (Agent Control shell) and stays alive. This validates: secure window creation, preload bridge, DB creation in userData, IPC registration.

- [ ] **Step 4: Verify Milestone 1 acceptance against the design doc**

Confirm each "Done when" item from `docs/superpowers/specs/2026-07-08-milestone-1-foundation-design.md`:
1. App launches with security baseline (Step 3).
2. Shell renders; categories come from adapter capabilities (code inspection: `navigation.ts` consumes `providers:capabilities`).
3. Projects add/list/remove persist across restart (store test covers persistence; UI wired end-to-end).
4. Overview shows real provider detection.
5. Spike tests pass with byte-identical guarantees (Step 1).

Report any gap honestly instead of claiming completion.

- [ ] **Step 5: Commit any fixes surfaced by verification**

```bash
git add -A
git commit -m "chore: milestone 1 verification fixes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip the commit if verification surfaced nothing.)
