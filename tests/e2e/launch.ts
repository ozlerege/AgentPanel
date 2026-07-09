import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { openDatabase } from '../../src/main/services/db'

export interface SeededRoots {
  home: string
  codexRoot: string
  claudeRoot: string
  claudeJson: string
  userData: string
  projectDir: string
}

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  roots: SeededRoots
  close(): Promise<void>
}

const CODEX_CONFIG = `# Codex configuration
model = "gpt-5.5"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
`

const CODEX_AGENT = `# Generated agent
name = "reviewer"
description = "Reviews pull requests"
developer_instructions = "Be meticulous."
`

export const CLAUDE_AGENT = `---
name: code-reviewer
description: Reviews pull requests for style issues
model: sonnet
custom: keep-this-field
---

<!-- preserve-this-comment -->
You are a meticulous code reviewer.
`

const BROKEN_CLAUDE_AGENT = `---
name: [unclosed
description: bad yaml
---

Body.
`

function createRoots(): SeededRoots {
  const home = mkdtempSync(join(tmpdir(), 'agent-control-e2e-'))
  const roots = {
    home,
    codexRoot: join(home, 'codex'),
    claudeRoot: join(home, 'claude'),
    claudeJson: join(home, 'claude.json'),
    userData: join(home, 'user-data'),
    projectDir: join(home, 'project')
  }
  mkdirSync(roots.userData, { recursive: true })
  mkdirSync(roots.projectDir, { recursive: true })
  return roots
}

function seedDefaultRoots(roots: SeededRoots): void {
  mkdirSync(join(roots.codexRoot, 'agents'), { recursive: true })
  mkdirSync(join(roots.claudeRoot, 'agents'), { recursive: true })
  mkdirSync(join(roots.claudeRoot, 'skills', 'writing-docs'), { recursive: true })
  writeFileSync(join(roots.codexRoot, 'config.toml'), CODEX_CONFIG)
  writeFileSync(join(roots.codexRoot, 'agents', 'reviewer.toml'), CODEX_AGENT)
  writeFileSync(join(roots.claudeRoot, 'agents', 'code-reviewer.md'), CLAUDE_AGENT)
  writeFileSync(join(roots.claudeRoot, 'agents', 'broken.md'), BROKEN_CLAUDE_AGENT)
  writeFileSync(join(roots.claudeRoot, 'skills', 'writing-docs', 'SKILL.md'), '# Writing docs\n')
  writeFileSync(join(roots.claudeRoot, 'CLAUDE.md'), '# Personal instructions\n\n- Prefer TypeScript.\n')
  writeFileSync(
    roots.claudeJson,
    '{\n  "mcpServers": {\n    "github": { "command": "npx", "args": ["-y", "server"] }\n  }\n}\n'
  )
}

async function launch(roots: SeededRoots): Promise<LaunchedApp> {
  const app = await _electron.launch({
    // '.' resolves package.json "main", so app.getAppPath() is the project
    // root exactly as in production — resource paths stay correct.
    args: ['.'],
    env: {
      ...process.env,
      AC_CODEX_ROOT: roots.codexRoot,
      AC_CLAUDE_ROOT: roots.claudeRoot,
      AC_CLAUDE_JSON: roots.claudeJson,
      AC_USER_DATA: roots.userData
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return {
    app,
    page,
    roots,
    close: async () => {
      await app.close()
    }
  }
}

export async function launchApp(seed?: (roots: SeededRoots) => void): Promise<LaunchedApp> {
  const roots = createRoots()
  seedDefaultRoots(roots)
  seed?.(roots)
  return launch(roots)
}

/** Starts another app process against existing disposable fixture roots. */
export async function relaunchApp(roots: SeededRoots): Promise<LaunchedApp> {
  return launch(roots)
}

export function disposeRoots(roots: SeededRoots): void {
  rmSync(roots.home, { recursive: true, force: true })
}

/** Registers the supplied fixture project without automating Electron's native picker. */
export function seedProject(roots: SeededRoots): void {
  const db = openDatabase(join(roots.userData, 'agent-control.db'))
  db.prepare('INSERT INTO projects (id, name, path, added_at) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    basename(roots.projectDir),
    roots.projectDir,
    new Date().toISOString()
  )
  db.close()
}

export function snapshotFiles(root: string, skip: string[] = []): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name)
      if (skip.includes(next)) continue
      if (entry.isDirectory()) walk(next)
      else if (entry.isFile()) files.set(next, readFileSync(next, 'utf8'))
    }
  }
  if (existsSync(root)) walk(root)
  return files
}
