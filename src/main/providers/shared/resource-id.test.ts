import { describe, expect, it } from 'vitest'
import { AppOperationError } from '../../errors'
import { decodeResourceId, encodeResourceId, type ResourceRef } from './resource-id'

const fullRef: ResourceRef = {
  provider: 'claude',
  kind: 'mcp-servers',
  scope: 'project',
  projectId: 'p1',
  path: '/repo/.mcp.json',
  entryKey: 'github'
}

describe('resource id codec', () => {
  it('round-trips a full ref', () => {
    expect(decodeResourceId(encodeResourceId(fullRef))).toEqual(fullRef)
  })

  it('round-trips a minimal ref and omits undefined keys', () => {
    const ref: ResourceRef = {
      provider: 'codex',
      kind: 'agents',
      scope: 'user',
      path: '/home/x/.codex/agents/a.toml'
    }
    const decoded = decodeResourceId(encodeResourceId(ref))
    expect(decoded).toEqual(ref)
    expect('projectId' in decoded).toBe(false)
    expect('entryKey' in decoded).toBe(false)
  })

  it('is deterministic for equal refs', () => {
    expect(encodeResourceId(fullRef)).toBe(encodeResourceId({ ...fullRef }))
  })

  it('throws invalid-request for garbage input', () => {
    try {
      decodeResourceId('not-a-real-id')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AppOperationError)
      expect((error as AppOperationError).code).toBe('invalid-request')
    }
  })

  it('throws invalid-request for valid base64 of the wrong shape', () => {
    const bogus = Buffer.from('{"nope":1}', 'utf8').toString('base64url')
    expect(() => decodeResourceId(bogus)).toThrowError(AppOperationError)
  })
})
