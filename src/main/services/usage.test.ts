import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { providerUsageSchema } from '../../shared/ipc'
import { UsageService } from './usage'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixtureRoots(): Promise<{ codexRoot: string; claudeRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'agent-control-usage-'))
  temporaryDirectories.push(root)
  const codexRoot = join(root, 'codex')
  const claudeRoot = join(root, 'claude')
  await Promise.all([
    mkdir(join(codexRoot, 'sessions', '2026', '07', '08'), { recursive: true }),
    mkdir(join(claudeRoot, 'projects', 'project-one'), { recursive: true })
  ])
  return { codexRoot, claudeRoot }
}

describe('UsageService', () => {
  it('normalizes local Codex and Claude usage without returning transcript content', async () => {
    const { codexRoot, claudeRoot } = await fixtureRoots()
    const codexSession = [
      {
        timestamp: '2026-07-08T09:00:00.000Z',
        type: 'session_meta',
        payload: { session_id: 'codex-session', timestamp: '2026-07-08T09:00:00.000Z', cwd: '/work/agent-panel' }
      },
      {
        timestamp: '2026-07-08T09:01:00.000Z',
        type: 'turn_context',
        payload: { model: 'gpt-test', cwd: '/work/agent-panel' }
      },
      {
        timestamp: '2026-07-08T09:02:00.000Z',
        type: 'response_item',
        payload: { type: 'message', content: 'private codex prompt' }
      },
      {
        timestamp: '2026-07-08T09:03:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { total_tokens: 1000 } },
          rate_limits: {
            primary: { used_percent: 25, window_minutes: 300, resets_at: 1783531104 },
            secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1784117904 }
          }
        }
      }
    ]
    await writeFile(
      join(codexRoot, 'sessions', '2026', '07', '08', 'rollout-test.jsonl'),
      codexSession.map((record) => JSON.stringify(record)).join('\n')
    )

    await writeFile(
      join(claudeRoot, 'stats-cache.json'),
      JSON.stringify({
        lastComputedDate: '2026-07-08',
        totalSessions: 3,
        dailyActivity: [{ date: '2026-07-08', sessionCount: 2 }],
        dailyModelTokens: [{ date: '2026-07-08', tokensByModel: { opus: 150 } }],
        modelUsage: {
          opus: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 200,
            cacheCreationInputTokens: 25
          }
        }
      })
    )
    const claudeSession = [
      {
        type: 'user',
        sessionId: 'claude-session',
        timestamp: '2026-07-08T10:00:00.000Z',
        cwd: '/work/agent-panel',
        message: { role: 'user', content: 'private claude prompt' }
      },
      {
        type: 'assistant',
        sessionId: 'claude-session',
        timestamp: '2026-07-08T10:01:00.000Z',
        cwd: '/work/agent-panel',
        message: {
          model: 'claude-test',
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4
          }
        }
      }
    ]
    await writeFile(
      join(claudeRoot, 'projects', 'project-one', '11111111-1111-1111-1111-111111111111.jsonl'),
      claudeSession.map((record) => JSON.stringify(record)).join('\n')
    )

    const result = await new UsageService({
      codexRoot,
      claudeRoot,
      now: () => new Date('2026-07-08T12:00:00.000Z')
    }).list()

    expect(result).toHaveLength(2)
    result.forEach((usage) => expect(providerUsageSchema.safeParse(usage).success).toBe(true))

    const codex = result.find((usage) => usage.providerId === 'codex')
    expect(codex?.limits.map((limit) => limit.label)).toEqual(['5 hour', '7 day'])
    expect(codex?.recentSessions[0]).toMatchObject({
      id: 'codex-session',
      project: 'agent-panel',
      model: 'gpt-test',
      tokens: 1000
    })

    const claude = result.find((usage) => usage.providerId === 'claude')
    expect(claude).toMatchObject({ status: 'partial', totalSessions: 3, totalTokens: 375 })
    expect(claude?.recentSessions[0]).toMatchObject({
      id: 'claude-session',
      project: 'agent-panel',
      model: 'claude-test',
      tokens: 10
    })
    expect(JSON.stringify(result)).not.toContain('private codex prompt')
    expect(JSON.stringify(result)).not.toContain('private claude prompt')
  })

  it('returns honest unavailable states when provider history is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-control-usage-empty-'))
    temporaryDirectories.push(root)
    const result = await new UsageService({
      codexRoot: join(root, 'codex'),
      claudeRoot: join(root, 'claude'),
      now: () => new Date('2026-07-08T12:00:00.000Z')
    }).list()

    expect(result.map((usage) => usage.status)).toEqual(['unavailable', 'unavailable'])
    expect(result.every((usage) => usage.daily.length === 14)).toBe(true)
  })
})
