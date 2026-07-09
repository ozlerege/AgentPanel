import { cpSync, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { ProviderId } from '../../shared/resource'
import { AppOperationError } from '../errors'
import type { ResourceService } from './resources'

const MAX_IMPORT_BYTES = 1024 * 1024

export interface ExchangeDialogs {
  saveFile(defaultName: string): Promise<string | null>
  pickDirectory(title: string): Promise<string | null>
  pickFile(filters: Array<{ name: string; extensions: string[] }>): Promise<string | null>
}

function importFilters(providerId: ProviderId, kind: string): Array<{ name: string; extensions: string[] }> {
  if (kind === 'agents' && providerId === 'codex') {
    return [{ name: 'Codex agents', extensions: ['toml'] }]
  }
  return [{ name: 'Markdown resources', extensions: ['md'] }]
}

export class ExchangeService {
  constructor(
    private readonly resources: ResourceService,
    private readonly dialogs: ExchangeDialogs
  ) {}

  async export(resourceId: string): Promise<{ savedTo: string | null }> {
    const doc = await this.resources.read(resourceId)
    const sourcePath = doc.sourcePaths[0]
    if (sourcePath === undefined) {
      throw new AppOperationError('not-found', 'resources:export', 'Resource has no source path')
    }
    if (doc.kind === 'mcp-servers') {
      throw new AppOperationError(
        'invalid-request',
        'resources:export',
        'Export is not supported for MCP server entries yet'
      )
    }
    if (doc.kind === 'skills') {
      const sourceDir = dirname(sourcePath)
      const destinationDir = await this.dialogs.pickDirectory('Export skill')
      if (destinationDir === null) return { savedTo: null }
      const target = join(destinationDir, basename(sourceDir))
      if (existsSync(target)) {
        throw new AppOperationError(
          'conflict',
          'resources:export',
          `Target already exists: ${target}`,
          { path: target }
        )
      }
      cpSync(sourceDir, target, { recursive: true })
      return { savedTo: target }
    }

    const destination = await this.dialogs.saveFile(basename(sourcePath))
    if (destination === null) return { savedTo: null }
    cpSync(sourcePath, destination)
    return { savedTo: destination }
  }

  async pickImport(
    providerId: ProviderId,
    kind: string
  ): Promise<{ fileName: string; raw: string } | null> {
    if (kind !== 'agents' && kind !== 'commands') {
      throw new AppOperationError(
        'invalid-request',
        'imports:pick',
        `Import is not supported for resource kind: ${kind}`
      )
    }
    const path = await this.dialogs.pickFile(importFilters(providerId, kind))
    if (path === null) return null
    const size = statSync(path).size
    if (size > MAX_IMPORT_BYTES) {
      throw new AppOperationError(
        'invalid-request',
        'imports:pick',
        `Import candidate is larger than 1 MiB: ${basename(path)}`,
        { path }
      )
    }
    return { fileName: basename(path), raw: await readFile(path, 'utf8') }
  }
}
