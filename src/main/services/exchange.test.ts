import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppOperationError } from '../errors'
import { createClaudeAdapter } from '../providers/claude'
import { ProviderRegistry } from '../providers/registry'
import { BackupService } from './backups'
import { openDatabase } from './db'
import { type ExchangeDialogs, ExchangeService } from './exchange'
import { ProjectsStore } from './projects-store'
import { ResourceService } from './resources'
import { TransactionService } from './transactions'

class FakeDialogs implements ExchangeDialogs {
  savePath: string | null = null
  directoryPath: string | null = null
  filePath: string | null = null

  async saveFile(): Promise<string | null> {
    return this.savePath
  }

  async pickDirectory(): Promise<string | null> {
    return this.directoryPath
  }

  async pickFile(): Promise<string | null> {
    return this.filePath
  }
}

let tmp: string
let dialogs: FakeDialogs
let resources: ResourceService
let exchange: ExchangeService

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agent-control-exchange-'))
  mkdirSync(join(tmp, 'claude', 'agents'), { recursive: true })
  mkdirSync(join(tmp, 'claude', 'skills', 'writing-docs', 'examples'), { recursive: true })
  writeFileSync(
    join(tmp, 'claude', 'agents', 'reviewer.md'),
    '---\nname: reviewer\ndescription: Reviews PRs\n---\n\nBe thorough.\n'
  )
  writeFileSync(
    join(tmp, 'claude', 'skills', 'writing-docs', 'SKILL.md'),
    '---\nname: writing-docs\ndescription: Writes docs\n---\n\nWrite clearly.\n'
  )
  writeFileSync(join(tmp, 'claude', 'skills', 'writing-docs', 'examples', 'brief.md'), 'Brief.\n')
  writeFileSync(
    join(tmp, 'claude.json'),
    '{ "mcpServers": { "github": { "command": "npx" } } }\n'
  )

  const registry = new ProviderRegistry()
  registry.register(
    createClaudeAdapter({ configRoot: join(tmp, 'claude'), userMcpPath: join(tmp, 'claude.json') })
  )
  const projects = new ProjectsStore(openDatabase(join(tmp, 'projects.db')))
  const backups = new BackupService(openDatabase(join(tmp, 'backups.db')), join(tmp, 'backups'))
  const transactions = new TransactionService({ roots: () => [tmp], files: () => [] }, backups)
  resources = new ResourceService(registry, projects, transactions, backups)
  dialogs = new FakeDialogs()
  exchange = new ExchangeService(resources, dialogs)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

async function resourceId(kind: string, name: string): Promise<string> {
  const summaries = await resources.list({ providerId: 'claude', kind })
  const summary = summaries.find((candidate) => candidate.name === name)
  if (summary === undefined) throw new Error(`missing resource ${kind}/${name}`)
  return summary.id
}

describe('ExchangeService.export', () => {
  it('copies a single-file resource to the save destination', async () => {
    const destination = join(tmp, 'exports', 'reviewer.md')
    mkdirSync(join(tmp, 'exports'))
    dialogs.savePath = destination

    const result = await exchange.export(await resourceId('agents', 'reviewer'))

    expect(result).toEqual({ savedTo: destination })
    expect(readFileSync(destination, 'utf8')).toContain('Reviews PRs')
  })

  it('copies a skill folder recursively and refuses an existing target', async () => {
    const destination = join(tmp, 'exports')
    mkdirSync(destination)
    dialogs.directoryPath = destination

    const result = await exchange.export(await resourceId('skills', 'writing-docs'))

    const copiedDir = join(destination, 'writing-docs')
    expect(result).toEqual({ savedTo: copiedDir })
    expect(readFileSync(join(copiedDir, 'SKILL.md'), 'utf8')).toContain('Writes docs')
    expect(readFileSync(join(copiedDir, 'examples', 'brief.md'), 'utf8')).toBe('Brief.\n')
    await expect(exchange.export(await resourceId('skills', 'writing-docs'))).rejects.toMatchObject({
      code: 'conflict'
    })
  })

  it('returns null when the dialog is cancelled', async () => {
    await expect(exchange.export(await resourceId('agents', 'reviewer'))).resolves.toEqual({
      savedTo: null
    })
  })

  it('rejects MCP server exports', async () => {
    await expect(exchange.export(await resourceId('mcp-servers', 'github'))).rejects.toSatisfy(
      (error: unknown) => error instanceof AppOperationError && error.code === 'invalid-request'
    )
  })
})

describe('ExchangeService.pickImport', () => {
  it('returns only the basename and raw content for an import candidate', async () => {
    const source = join(tmp, 'picked.md')
    writeFileSync(source, '---\nname: imported\n---\n\nImported body.\n')
    dialogs.filePath = source

    await expect(exchange.pickImport('claude', 'agents')).resolves.toEqual({
      fileName: 'picked.md',
      raw: '---\nname: imported\n---\n\nImported body.\n'
    })
  })

  it('rejects files larger than 1 MiB', async () => {
    const source = join(tmp, 'large.md')
    writeFileSync(source, 'x'.repeat(1024 * 1024 + 1))
    dialogs.filePath = source

    await expect(exchange.pickImport('claude', 'commands')).rejects.toMatchObject({
      code: 'invalid-request'
    })
  })

  it('rejects unsupported import kinds', async () => {
    await expect(exchange.pickImport('claude', 'skills')).rejects.toMatchObject({
      code: 'invalid-request'
    })
  })

  it('returns null when file picking is cancelled', async () => {
    await expect(exchange.pickImport('codex', 'agents')).resolves.toBeNull()
  })

  it('does not expose picked paths through the returned file name', async () => {
    const source = join(tmp, 'nested', 'candidate.md')
    mkdirSync(join(tmp, 'nested'))
    writeFileSync(source, 'body\n')
    dialogs.filePath = source

    const result = await exchange.pickImport('claude', 'commands')

    expect(result?.fileName).toBe('candidate.md')
    expect(result?.fileName).not.toContain(tmp)
    expect(statSync(source).isFile()).toBe(true)
    expect(existsSync(source)).toBe(true)
  })
})
