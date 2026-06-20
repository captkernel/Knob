import { describe, it, expect } from 'vitest'
import { retrySchedule } from '../src/main/hotkeyRetry'

describe('retrySchedule', () => {
  it('is a non-empty list of strictly increasing, finite, positive delays', () => {
    const s = retrySchedule()
    expect(s.length).toBeGreaterThan(0)
    for (const d of s) {
      expect(Number.isFinite(d)).toBe(true)
      expect(d).toBeGreaterThan(0)
    }
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1])
  })

  it('spans enough time to outlast a typical login race (>20s total)', () => {
    const total = retrySchedule().reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(20_000)
  })
})
