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
