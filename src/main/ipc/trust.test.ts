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
