import { describe, it, expect } from 'vitest'
import { rmsLevel } from '../src/renderer/src/lib/micMeter'

// AnalyserNode.getByteTimeDomainData returns Uint8 samples centered on 128
// (128 == silence). rmsLevel normalizes the RMS deviation from 128 to 0..1.
describe('rmsLevel', () => {
  it('returns ~0 for pure silence (all 128)', () => {
    const data = new Uint8Array(1024).fill(128)
    expect(rmsLevel(data)).toBeCloseTo(0, 5)
  })

  it('returns a high level for a full-swing square wave', () => {
    const data = new Uint8Array(8)
    for (let i = 0; i < data.length; i++) data[i] = i % 2 === 0 ? 0 : 255
    // deviation ~128/128 = ~1
    expect(rmsLevel(data)).toBeGreaterThan(0.9)
  })

  it('is monotonic: louder input yields a higher level', () => {
    const quiet = new Uint8Array(64)
    const loud = new Uint8Array(64)
    for (let i = 0; i < 64; i++) {
      quiet[i] = i % 2 === 0 ? 118 : 138 // ±10
      loud[i] = i % 2 === 0 ? 78 : 178 // ±50
    }
    expect(rmsLevel(loud)).toBeGreaterThan(rmsLevel(quiet))
  })

  it('clamps into 0..1', () => {
    const data = new Uint8Array(4).fill(0) // max deviation
    const lvl = rmsLevel(data)
    expect(lvl).toBeGreaterThanOrEqual(0)
    expect(lvl).toBeLessThanOrEqual(1)
  })

  it('returns 0 for an empty buffer (no divide-by-zero)', () => {
    expect(rmsLevel(new Uint8Array(0))).toBe(0)
  })
})
