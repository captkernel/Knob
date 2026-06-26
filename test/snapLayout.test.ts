import { describe, it, expect } from 'vitest'
import { snapDrag, normalize } from '../src/renderer/src/lib/snapLayout'
import type { MonitorState } from '../src/shared/types'

const m = (id: string, o: Partial<MonitorState> = {}): MonitorState => ({
  id, device: `\\\\.\\${id}`, name: id, enabled: true, primary: false,
  x: 0, y: 0, width: 1000, height: 1000, ...o
})

describe('snapDrag', () => {
  const anchor = m('anchor', { x: 0, y: 0, width: 1000, height: 1000 })
  it('snaps the dragged left edge to a neighbour right edge within threshold', () => {
    // proposed left at 990, anchor right at 1000 → within 50 → snaps x to 1000
    const r = snapDrag(m('drag'), [anchor], { x: 990, y: 0 }, 50)
    expect(r.x).toBe(1000)
  })
  it('leaves position unchanged when outside threshold', () => {
    const r = snapDrag(m('drag'), [anchor], { x: 900, y: 0 }, 50)
    expect(r.x).toBe(900)
  })
  it('snaps top edges together vertically within threshold', () => {
    const r = snapDrag(m('drag'), [anchor], { x: 1000, y: 8 }, 50)
    expect(r.y).toBe(0)
  })
  it('ignores disabled neighbours as snap targets', () => {
    const off = m('off', { x: 0, y: 0, enabled: false })
    const r = snapDrag(m('drag'), [off], { x: 990, y: 0 }, 50)
    expect(r.x).toBe(990)
  })
  it('does not snap the dragged monitor to itself when present in others', () => {
    const drag = m('drag', { x: 990, y: 0 })
    const r = snapDrag(drag, [drag], { x: 990, y: 0 }, 50)
    expect(r.x).toBe(990)
  })
  it('snaps to the nearest neighbour edge when two are within threshold', () => {
    const near = m('near', { x: 1005, y: 0 }) // left edge 1005, 5 from dragged right edge (1000)
    const far = m('far', { x: 960, y: 0 })    // right edge 1960, distance larger
    // dragged spans 0..1000; near.left(1005) is 5 from dragged.right(1000); snap right edge to 1005
    const r = snapDrag(m('drag'), [near, far], { x: 0, y: 0 }, 50)
    // nearest edge alignment wins: dragged.right(1000) -> near.left(1005) is +5
    expect(r.x).toBe(5)
  })
})

describe('normalize', () => {
  it('resolves an overlap by right-packing the later monitor', () => {
    const a = m('a', { x: 0, primary: true })
    const b = m('b', { x: 500 }) // overlaps a (a spans 0..1000)
    const out = normalize([a, b])
    const nb = out.find((x) => x.id === 'b')!
    expect(nb.x).toBe(1000) // pushed to a's right edge
  })
  it('anchors the primary at origin', () => {
    const a = m('a', { x: 1920, y: 100, primary: true })
    const b = m('b', { x: 2920, y: 100 })
    const out = normalize([a, b])
    expect(out.find((x) => x.id === 'a')!.x).toBe(0)
    expect(out.find((x) => x.id === 'a')!.y).toBe(0)
    expect(out.find((x) => x.id === 'b')!.x).toBe(1000)
  })
  it('excludes disabled monitors from packing but still translates them by the anchor', () => {
    const a = m('a', { x: 1000, primary: true })
    const off = m('off', { x: 1000, enabled: false }) // same x as a, but disabled
    const out = normalize([a, off])
    expect(out.find((x) => x.id === 'a')!.x).toBe(0)
    // disabled not packed (not pushed right), only translated by -1000
    expect(out.find((x) => x.id === 'off')!.x).toBe(0)
  })
  it('packs three mutually-overlapping monitors into a contiguous row', () => {
    const a = m('a', { x: 0, primary: true })
    const b = m('b', { x: 100 })
    const c = m('c', { x: 200 })
    const out = normalize([a, b, c])
    const xs = ['a', 'b', 'c'].map((id) => out.find((z) => z.id === id)!.x)
    expect(xs).toEqual([0, 1000, 2000])
  })
})
