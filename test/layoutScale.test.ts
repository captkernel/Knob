import { describe, it, expect } from 'vitest'
import { computeScale, monitorToCanvas, canvasToMonitor, scaledRects } from '../src/renderer/src/lib/layoutScale'
import type { MonitorState } from '../src/shared/types'

const m = (id: string, o: Partial<MonitorState> = {}): MonitorState => ({
  id, device: `\\\\.\\${id}`, name: id, enabled: true, primary: false,
  x: 0, y: 0, width: 1920, height: 1080, ...o
})

describe('computeScale', () => {
  it('returns null when no enabled monitor has positive area', () => {
    expect(computeScale([], 280, 150, 8)).toBeNull()
    expect(computeScale([m('a', { enabled: false })], 280, 150, 8)).toBeNull()
    expect(computeScale([m('a', { width: 0, height: 0 })], 280, 150, 8)).toBeNull()
  })
  it('fits the enabled bounding box preserving aspect ratio', () => {
    // single 1920x1080 into 280x150 (padding 8 → avail 264x134): scale = min(264/1920,134/1080)=0.1240..
    const s = computeScale([m('a')], 280, 150, 8)!
    expect(s.scale).toBeCloseTo(Math.min(264 / 1920, 134 / 1080), 6)
    expect(s.minX).toBe(0)
    expect(s.minY).toBe(0)
  })
})

describe('monitor<->canvas round-trip', () => {
  it('canvasToMonitor inverts monitorToCanvas', () => {
    const s = computeScale([m('a'), m('b', { x: 1920 })], 280, 150, 8)!
    const { cx, cy } = monitorToCanvas(1920, 0, s)
    const back = canvasToMonitor(cx, cy, s)
    expect(back.x).toBeCloseTo(1920, 4)
    expect(back.y).toBeCloseTo(0, 4)
  })
})

describe('scaledRects', () => {
  it('maps each monitor to a rect with a 2px minimum size', () => {
    const s = computeScale([m('a')], 280, 150, 8)!
    const [r] = scaledRects([m('a')], s)
    expect(r.sw).toBeGreaterThanOrEqual(2)
    expect(r.sh).toBeGreaterThanOrEqual(2)
    expect(r.sx).toBeCloseTo(s.offsetX, 4)
  })
})
