import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sweepStaleTempFiles } from './temp-sweep'

let tmp: string | undefined

afterEach(() => {
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

describe('sweepStaleTempFiles', () => {
  it('removes stale transaction temp files throughout nested roots only', () => {
    tmp = mkdtempSync(join(tmpdir(), 'agent-control-sweep-'))
    const firstRoot = join(tmp, 'first')
    const nestedRoot = join(tmp, 'second', 'nested')
    const firstTemp = join(firstRoot, '.agent-control-tmp-101-agent.md')
    const nestedTemp = join(nestedRoot, '.agent-control-tmp-202-agent.md')
    const freshFile = join(nestedRoot, 'agent.md')
    const nearMatch = join(firstRoot, '.agent-control-tmpish-agent.md')
    mkdirSync(nestedRoot, { recursive: true })
    mkdirSync(firstRoot, { recursive: true })
    writeFileSync(firstTemp, 'stale')
    writeFileSync(nestedTemp, 'stale')
    writeFileSync(freshFile, 'fresh')
    writeFileSync(nearMatch, 'fresh')

    expect(sweepStaleTempFiles([firstRoot, join(tmp, 'second')])).toEqual(
      expect.arrayContaining([firstTemp, nestedTemp])
    )
    expect(existsSync(firstTemp)).toBe(false)
    expect(existsSync(nestedTemp)).toBe(false)
    expect(existsSync(freshFile)).toBe(true)
    expect(existsSync(nearMatch)).toBe(true)
  })

  it('tolerates roots that are missing or unreadable', () => {
    tmp = mkdtempSync(join(tmpdir(), 'agent-control-sweep-'))
    expect(sweepStaleTempFiles([join(tmp, 'missing')])).toEqual([])
  })
})
