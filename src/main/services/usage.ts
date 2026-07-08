import { open, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import type { DailyUsage, ProviderUsage, RecentSession, UsageWindow } from '../../shared/ipc'

const DAY_MS = 24 * 60 * 60 * 1000
const HISTORY_DAYS = 30
const RECENT_SESSION_LIMIT = 5
const MAX_CODEX_FILES = 400
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f-]{27}\.jsonl$/i
const CODEX_METADATA_RECORD = /"type"\s*:\s*"(?:session_meta|turn_context)"/
const CLAUDE_SESSION_RECORD = /"type"\s*:\s*"(?:user|assistant)"/

interface UsageServiceOptions {
  codexRoot?: string
  claudeRoot?: string
  now?: () => Date
}

interface FileEntry {
  path: string
  modifiedAt: Date
  size: number
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isoValue(value: unknown, fallback: Date): string {
  const raw = stringValue(value)
  if (raw) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return fallback.toISOString()
}

function projectName(cwd: unknown): string {
  const value = stringValue(cwd)
  return value ? basename(value) || value : 'Unknown project'
}

async function listJsonlFiles(root: string): Promise<FileEntry[]> {
  const files: FileEntry[] = []

  async function walk(directory: string): Promise<void> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return walk(path)
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return
        try {
          const info = await stat(path)
          files.push({ path, modifiedAt: info.mtime, size: info.size })
        } catch {
          // Files can disappear while a provider is updating its history.
        }
      })
    )
  }

  await walk(root)
  return files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
}

async function readJsonRecords(
  file: FileEntry,
  shouldParse: (line: string) => boolean
): Promise<JsonRecord[]> {
  const headBytes = 32 * 1024
  const tailBytes = 256 * 1024
  let content = ''

  try {
    if (file.size <= headBytes + tailBytes) {
      content = await readFile(file.path, 'utf8')
    } else {
      const handle = await open(file.path, 'r')
      try {
        const head = Buffer.alloc(headBytes)
        const tail = Buffer.alloc(tailBytes)
        await handle.read(head, 0, headBytes, 0)
        await handle.read(tail, 0, tailBytes, file.size - tailBytes)
        const tailText = tail.toString('utf8')
        content = `${head.toString('utf8').replace(/[^\n]*$/, '')}${tailText.replace(/^[^\n]*\n?/, '')}`
      } finally {
        await handle.close()
      }
    }
  } catch {
    return []
  }

  const records: JsonRecord[] = []
  for (const line of content.split('\n')) {
    if (!line || !shouldParse(line)) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isRecord(parsed)) records.push(parsed)
    } catch {
      // Ignore a partial or malformed provider record.
    }
  }
  return records
}

async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  transform: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(...(await Promise.all(items.slice(index, index + batchSize).map(transform))))
    await yieldToEventLoop()
  }
  return results
}

function makeDays(now: Date): DailyUsage[] {
  const days: DailyUsage[] = []
  for (let offset = 13; offset >= 0; offset--) {
    const date = new Date(now)
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - offset)
    days.push({ date: date.toISOString().slice(0, 10), sessions: 0, tokens: 0 })
  }
  return days
}

function sumDailyTokens(days: DailyUsage[]): number {
  return days.reduce((total, day) => total + day.tokens, 0)
}

function codexWindow(value: unknown, fallbackLabel: string): UsageWindow | null {
  if (!isRecord(value)) return null
  const usedPercent = numberValue(value['used_percent'])
  const windowMinutes = numberValue(value['window_minutes'])
  const resetsAt = numberValue(value['resets_at'])
  if (windowMinutes === 0 || resetsAt === 0) return null
  const hours = windowMinutes / 60
  const label = hours >= 24 ? `${Math.round(hours / 24)} day` : `${Math.round(hours)} hour`
  return {
    label: label || fallbackLabel,
    usedPercent: Math.min(100, usedPercent),
    windowMinutes,
    resetsAt: new Date(resetsAt * 1000).toISOString()
  }
}

interface ParsedCodexSession {
  session: RecentSession
  limitTimestamp: number
  limits: UsageWindow[]
}

function parseCodexSession(file: FileEntry, records: JsonRecord[]): ParsedCodexSession {
  let id = basename(file.path, '.jsonl')
  let startedAt = file.modifiedAt.toISOString()
  let cwd: unknown
  let model: string | undefined
  let tokens = 0
  let limits: UsageWindow[] = []
  let limitTimestamp = 0

  for (const record of records) {
    const payload = isRecord(record['payload']) ? record['payload'] : undefined
    if (!payload) continue
    if (record['type'] === 'session_meta') {
      id = stringValue(payload['session_id']) ?? stringValue(payload['id']) ?? id
      startedAt = isoValue(payload['timestamp'] ?? record['timestamp'], file.modifiedAt)
      cwd = payload['cwd'] ?? cwd
    }
    if (record['type'] === 'turn_context') {
      model = stringValue(payload['model']) ?? model
      cwd = payload['cwd'] ?? cwd
    }
    if (record['type'] === 'event_msg' && payload['type'] === 'token_count') {
      const info = isRecord(payload['info']) ? payload['info'] : undefined
      const total = info && isRecord(info['total_token_usage']) ? info['total_token_usage'] : undefined
      tokens = total ? numberValue(total['total_tokens']) : tokens
      const rateLimits = isRecord(payload['rate_limits']) ? payload['rate_limits'] : undefined
      if (rateLimits) {
        const next = [
          codexWindow(rateLimits['primary'], 'Primary'),
          codexWindow(rateLimits['secondary'], 'Secondary')
        ].filter((window): window is UsageWindow => window !== null)
        if (next.length > 0) {
          limits = next
          limitTimestamp = new Date(isoValue(record['timestamp'], file.modifiedAt)).getTime()
        }
      }
    }
  }

  return {
    session: {
      id,
      startedAt,
      updatedAt: file.modifiedAt.toISOString(),
      project: projectName(cwd),
      model,
      tokens: Math.round(tokens)
    },
    limitTimestamp,
    limits
  }
}

async function collectCodex(root: string, now: Date): Promise<ProviderUsage> {
  const files = await listJsonlFiles(join(root, 'sessions'))
  const cutoff = now.getTime() - HISTORY_DAYS * DAY_MS
  const selected = files
    .filter((file, index) => index < 20 || file.modifiedAt.getTime() >= cutoff)
    .slice(0, MAX_CODEX_FILES)
  const parsed = await mapInBatches(
    selected,
    8,
    async (file) =>
      parseCodexSession(
        file,
        await readJsonRecords(
          file,
          (line) =>
            CODEX_METADATA_RECORD.test(line) ||
            (line.includes('"event_msg"') && line.includes('"token_count"'))
        )
      )
  )
  const days = makeDays(now)
  const dayMap = new Map(days.map((day) => [day.date, day]))
  for (const item of parsed) {
    const day = dayMap.get(item.session.startedAt.slice(0, 10))
    if (day) {
      day.sessions += 1
      day.tokens += item.session.tokens
    }
  }
  const latestLimits = parsed
    .filter((item) => item.limits.length > 0)
    .sort((a, b) => b.limitTimestamp - a.limitTimestamp)[0]
  const updatedAt = files[0]?.modifiedAt.toISOString() ?? null

  return {
    providerId: 'codex',
    status: files.length === 0 ? 'unavailable' : latestLimits ? 'available' : 'partial',
    source: 'Local Codex session history',
    updatedAt,
    limits: latestLimits?.limits ?? [],
    totalSessions: files.length,
    totalTokens: sumDailyTokens(days),
    daily: days,
    recentSessions: parsed
      .map((item) => item.session)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, RECENT_SESSION_LIMIT),
    message:
      files.length === 0
        ? 'No local Codex sessions were found.'
        : latestLimits
          ? undefined
          : 'Codex has not written a recent rate-limit snapshot yet.'
  }
}

function sumClaudeModelUsage(value: unknown): number {
  if (!isRecord(value)) return 0
  return Object.values(value).reduce<number>((total, item) => {
    if (!isRecord(item)) return total
    return (
      total +
      numberValue(item['inputTokens']) +
      numberValue(item['outputTokens']) +
      numberValue(item['cacheReadInputTokens']) +
      numberValue(item['cacheCreationInputTokens'])
    )
  }, 0)
}

function parseClaudeSession(file: FileEntry, records: JsonRecord[]): RecentSession {
  let id = basename(file.path, '.jsonl')
  let startedAt = file.modifiedAt.toISOString()
  let updatedAt = file.modifiedAt.toISOString()
  let cwd: unknown
  let model: string | undefined
  let tokens = 0

  for (const record of records) {
    id = stringValue(record['sessionId']) ?? stringValue(record['session_id']) ?? id
    if (record['timestamp']) {
      const timestamp = isoValue(record['timestamp'], file.modifiedAt)
      if (startedAt === file.modifiedAt.toISOString()) startedAt = timestamp
      updatedAt = timestamp
    }
    cwd = record['cwd'] ?? cwd
    if (record['type'] === 'assistant' && isRecord(record['message'])) {
      const message = record['message']
      model = stringValue(message['model']) ?? model
      if (isRecord(message['usage'])) {
        const usage = message['usage']
        tokens +=
          numberValue(usage['input_tokens']) +
          numberValue(usage['output_tokens']) +
          numberValue(usage['cache_read_input_tokens']) +
          numberValue(usage['cache_creation_input_tokens'])
      }
    }
  }

  return {
    id,
    startedAt,
    updatedAt,
    project: projectName(cwd),
    model,
    tokens: Math.round(tokens)
  }
}

async function collectClaude(root: string, now: Date): Promise<ProviderUsage> {
  const [files, statsResult] = await Promise.all([
    listJsonlFiles(join(root, 'projects')),
    readFile(join(root, 'stats-cache.json'), 'utf8').catch(() => null)
  ])
  let stats: JsonRecord | null = null
  if (statsResult) {
    try {
      const parsed: unknown = JSON.parse(statsResult)
      stats = isRecord(parsed) ? parsed : null
    } catch {
      stats = null
    }
  }

  const mainFiles = files.filter((file) => UUID_FILE.test(basename(file.path)))
  const recentSessions = await Promise.all(
    mainFiles.slice(0, RECENT_SESSION_LIMIT).map(async (file) =>
      parseClaudeSession(file, await readJsonRecords(file, (line) => CLAUDE_SESSION_RECORD.test(line)))
    )
  )
  const days = makeDays(now)
  const dayMap = new Map(days.map((day) => [day.date, day]))
  if (stats && Array.isArray(stats['dailyActivity'])) {
    for (const value of stats['dailyActivity']) {
      if (!isRecord(value)) continue
      const day = dayMap.get(stringValue(value['date']) ?? '')
      if (day) day.sessions = Math.round(numberValue(value['sessionCount']))
    }
  }
  if (stats && Array.isArray(stats['dailyModelTokens'])) {
    for (const value of stats['dailyModelTokens']) {
      if (!isRecord(value)) continue
      const day = dayMap.get(stringValue(value['date']) ?? '')
      if (day && isRecord(value['tokensByModel'])) {
        day.tokens = Math.round(
          Object.values(value['tokensByModel']).reduce<number>(
            (total, tokens) => total + numberValue(tokens),
            0
          )
        )
      }
    }
  }

  const hasData = stats !== null || mainFiles.length > 0
  const updatedAt = stats
    ? isoValue(`${stringValue(stats['lastComputedDate']) ?? now.toISOString().slice(0, 10)}T23:59:59Z`, now)
    : mainFiles[0]?.modifiedAt.toISOString() ?? null
  return {
    providerId: 'claude',
    status: hasData ? 'partial' : 'unavailable',
    source: 'Local Claude statistics and session history',
    updatedAt,
    limits: [],
    totalSessions: Math.round(numberValue(stats?.['totalSessions'])) || mainFiles.length,
    totalTokens: stats ? Math.round(sumClaudeModelUsage(stats['modelUsage'])) : sumDailyTokens(days),
    daily: days,
    recentSessions,
    message: hasData
      ? 'Claude does not persist subscription limits in local session history.'
      : 'No local Claude usage data was found.'
  }
}

export class UsageService {
  private readonly codexRoot: string
  private readonly claudeRoot: string
  private readonly now: () => Date

  constructor(options: UsageServiceOptions = {}) {
    this.codexRoot = options.codexRoot ?? join(homedir(), '.codex')
    this.claudeRoot = options.claudeRoot ?? join(homedir(), '.claude')
    this.now = options.now ?? (() => new Date())
  }

  async list(): Promise<ProviderUsage[]> {
    const now = this.now()
    return Promise.all([collectCodex(this.codexRoot, now), collectClaude(this.claudeRoot, now)])
  }
}
