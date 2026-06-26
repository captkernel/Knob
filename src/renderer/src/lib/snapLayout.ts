import type { MonitorState } from '@shared/types'

function rectsOverlap(a: MonitorState, b: MonitorState): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Snap the dragged monitor's edges to nearby ENABLED neighbours within `threshold`
 *  (monitor px). Returns the adjusted top-left. Pure; monitor coordinates. */
export function snapDrag(
  dragged: MonitorState,
  others: MonitorState[],
  proposed: { x: number; y: number },
  threshold: number
): { x: number; y: number } {
  const w = dragged.width
  const h = dragged.height
  let x = proposed.x
  let y = proposed.y
  const targets = others.filter((o) => o.enabled && o.id !== dragged.id)

  // X: align my left/right edges to their left/right edges. Pick the smallest shift.
  let bestDx = threshold
  for (const o of targets) {
    const candidates = [o.x + o.width - x, o.x - x, o.x - (x + w), o.x + o.width - (x + w)]
    for (const d of candidates) if (Math.abs(d) < Math.abs(bestDx)) bestDx = d
  }
  if (Math.abs(bestDx) < threshold) x += bestDx

  // Y: align top/bottom/center.
  let bestDy = threshold
  for (const o of targets) {
    const candidates = [
      o.y - y,
      o.y + o.height - (y + h),
      o.y + o.height - y,
      o.y - (y + h),
      o.y + o.height / 2 - (y + h / 2)
    ]
    for (const d of candidates) if (Math.abs(d) < Math.abs(bestDy)) bestDy = d
  }
  if (Math.abs(bestDy) < threshold) y += bestDy

  return { x, y }
}

/** Resolve overlaps among ENABLED monitors (deterministic left-to-right pack), then anchor
 *  the primary at origin. Disabled monitors are excluded from packing but translated by the
 *  anchor. Returns a new array; inputs are not mutated. */
export function normalize(monitors: MonitorState[]): MonitorState[] {
  const out = monitors.map((m) => ({ ...m }))
  const enabled = out.filter((m) => m.enabled)

  const placed: MonitorState[] = []
  for (const m of [...enabled].sort((a, b) => a.x - b.x || a.y - b.y)) {
    let pushTo = m.x
    for (const p of placed) if (rectsOverlap(m, p)) pushTo = Math.max(pushTo, p.x + p.width)
    m.x = pushTo
    placed.push(m)
  }

  const primary = out.find((m) => m.primary && m.enabled) ?? enabled[0]
  if (primary) {
    const dx = primary.x
    const dy = primary.y
    for (const m of out) {
      m.x -= dx
      m.y -= dy
    }
  }
  return out
}
