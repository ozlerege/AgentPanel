import { describe, expect, it } from 'vitest'
import { formatFieldValue, maskSecretText, maskValue } from './mask'

describe('maskSecretText', () => {
  it('masks provider-prefixed tokens', () => {
    expect(
      maskSecretText('--access-token=sbp_839af9cff7c851047bd63ba87173d29b35e098c0')
    ).toBe('--access-token=••••')
    expect(maskSecretText('ghp_example1234567890abcd')).toBe('••••')
  })

  it('masks key=value credential assignments', () => {
    expect(maskSecretText('password=hunter2secret')).toBe('password=••••')
  })

  it('leaves ordinary text alone', () => {
    expect(maskSecretText('npx')).toBe('npx')
    expect(maskSecretText('@modelcontextprotocol/server-github')).toBe(
      '@modelcontextprotocol/server-github'
    )
  })
})

describe('maskValue', () => {
  it('masks whole values under secret-like keys', () => {
    expect(maskValue('apiKey', 'plainvalue')).toBe('••••')
    expect(maskValue('GITHUB_TOKEN', 'anything')).toBe('••••')
  })

  it('recurses into objects, masking by nested key', () => {
    expect(
      maskValue('env', { GITHUB_TOKEN: 'ghp_example1234567890abcd', PORT: '3000' })
    ).toEqual({ GITHUB_TOKEN: '••••', PORT: '3000' })
  })

  it('masks token-shaped strings inside arrays', () => {
    expect(
      maskValue('args', [
        '-y',
        '--access-token=sbp_839af9cff7c851047bd63ba87173d29b35e098c0'
      ])
    ).toEqual(['-y', '--access-token=••••'])
  })

  it('passes through non-secret scalars', () => {
    expect(maskValue('command', 'npx')).toBe('npx')
    expect(maskValue('startup_timeout_sec', 120)).toBe(120)
  })
})

describe('formatFieldValue', () => {
  it('returns strings directly and JSON for structures', () => {
    expect(formatFieldValue('command', 'npx')).toBe('npx')
    expect(formatFieldValue('env', { PORT: '3000' })).toBe('{\n  "PORT": "3000"\n}')
  })
})
