import { Star } from 'lucide-react'
import type { MonitorState } from '@shared/types'
import { computeScale, scaledRects } from '../lib/layoutScale'

const CANVAS_W = 280
const CANVAS_H = 150
const PADDING = 8 // inset so border rects aren't clipped

export function LayoutDiagram({ monitors }: { monitors: MonitorState[] }): JSX.Element {
  const scale = monitors.length > 0 ? computeScale(monitors, CANVAS_W, CANVAS_H, PADDING) : null
  const layout = scale ? scaledRects(monitors, scale) : null

  // Placeholder: no monitors or all zero-dimension
  if (!layout) {
    return (
      <div
        className="grid place-items-center rounded-2xl border border-dashed border-white/10 text-sm text-white/40"
        style={{ width: CANVAS_W, height: CANVAS_H }}
      >
        No displays detected
      </div>
    )
  }

  return (
    <div
      className="relative rounded-2xl border border-white/10 bg-white/5"
      style={{ width: CANVAS_W, height: CANVAS_H }}
      aria-label="Monitor layout diagram"
    >
      {layout.map(({ m, sx, sy, sw, sh }) => {
        const disabled = !m.enabled
        return (
          <div
            key={m.id}
            className={`absolute flex flex-col items-center justify-center overflow-hidden rounded-xl border transition-opacity ${
              disabled
                ? 'border-dashed border-white/20 bg-white/[0.02] opacity-40'
                : 'border-white/20 bg-white/[0.08]'
            }`}
            style={{
              left: sx,
              top: sy,
              width: sw,
              height: sh
            }}
            title={`${m.name} — ${m.width}×${m.height}${m.refreshHz ? ` @ ${m.refreshHz} Hz` : ''}${disabled ? ' (disabled)' : ''}${m.primary ? ' · Primary' : ''}`}
          >
            {/* Primary star — top-right corner */}
            {m.primary && (
              <span
                className="absolute right-1 top-1 text-accent"
                aria-label="Primary display"
                style={{ lineHeight: 1 }}
              >
                <Star
                  size={Math.min(10, Math.max(6, sw * 0.14))}
                  fill="rgb(var(--accent))"
                  stroke="rgb(var(--accent))"
                />
              </span>
            )}

            {/* Labels — only shown when rect is large enough to be legible */}
            {sw >= 36 && sh >= 22 && (
              <div className="flex flex-col items-center gap-0.5 px-1 text-center">
                {sh >= 34 && (
                  <span
                    className="max-w-full truncate font-medium leading-tight text-white/80"
                    style={{ fontSize: Math.min(9, Math.max(6, sw * 0.12)) }}
                  >
                    {m.name}
                  </span>
                )}
                <span
                  className="leading-tight text-white/50"
                  style={{ fontSize: Math.min(8, Math.max(5, sw * 0.10)) }}
                >
                  {m.width}×{m.height}
                  {m.refreshHz != null && ` · ${m.refreshHz} Hz`}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
