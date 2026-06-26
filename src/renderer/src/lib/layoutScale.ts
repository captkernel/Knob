import type { MonitorState } from '@shared/types'

export interface LayoutScale {
  scale: number
  offsetX: number
  offsetY: number
  minX: number
  minY: number
}

export interface ScaledRect {
  m: MonitorState
  sx: number
  sy: number
  sw: number
  sh: number
}

/** Scale + offsets that fit the ENABLED monitors' bounding box into the canvas (minus
 *  padding), preserving aspect ratio and centering. null if no enabled monitor has area. */
export function computeScale(
  monitors: MonitorState[],
  canvasW: number,
  canvasH: number,
  padding: number
): LayoutScale | null {
  const enabled = monitors.filter((m) => m.enabled && m.width > 0 && m.height > 0)
  if (enabled.length === 0) return null
  const minX = Math.min(...enabled.map((m) => m.x))
  const minY = Math.min(...enabled.map((m) => m.y))
  const maxX = Math.max(...enabled.map((m) => m.x + m.width))
  const maxY = Math.max(...enabled.map((m) => m.y + m.height))
  const totalW = maxX - minX
  const totalH = maxY - minY
  if (totalW === 0 || totalH === 0) return null
  const availW = canvasW - padding * 2
  const availH = canvasH - padding * 2
  const scale = Math.min(availW / totalW, availH / totalH)
  const offsetX = padding + (availW - totalW * scale) / 2
  const offsetY = padding + (availH - totalH * scale) / 2
  return { scale, offsetX, offsetY, minX, minY }
}

/** Monitor coords (top-left) → canvas px (top-left). */
export function monitorToCanvas(x: number, y: number, s: LayoutScale): { cx: number; cy: number } {
  return { cx: s.offsetX + (x - s.minX) * s.scale, cy: s.offsetY + (y - s.minY) * s.scale }
}

/** Canvas px (top-left) → monitor coords. Inverse of monitorToCanvas. */
export function canvasToMonitor(cx: number, cy: number, s: LayoutScale): { x: number; y: number } {
  return { x: s.minX + (cx - s.offsetX) / s.scale, y: s.minY + (cy - s.offsetY) / s.scale }
}

/** Map every monitor into a scaled rect for rendering (2px minimum size). */
export function scaledRects(monitors: MonitorState[], s: LayoutScale): ScaledRect[] {
  return monitors.map((m) => {
    const { cx, cy } = monitorToCanvas(m.x, m.y, s)
    return { m, sx: cx, sy: cy, sw: Math.max(m.width * s.scale, 2), sh: Math.max(m.height * s.scale, 2) }
  })
}
