import { useRef, useState } from 'react'
import { Power, Star, Check, X } from 'lucide-react'
import type { MonitorState } from '@shared/types'
import { computeScale, scaledRects } from '../lib/layoutScale'
import { snapDrag, normalize } from '../lib/snapLayout'

const CANVAS_W = 340
const CANVAS_H = 190
const PADDING = 12
const SNAP_PX = 10 // snap feel in canvas px (converted to monitor px via scale)

export interface LayoutEditorProps {
  seed: MonitorState[]
  initialName?: string
  onApply: (monitors: MonitorState[]) => void
  onSave: (monitors: MonitorState[], name: string) => void
  onCancel: () => void
}

export function LayoutEditor({ seed, initialName, onApply, onSave, onCancel }: LayoutEditorProps): JSX.Element {
  const [draft, setDraft] = useState<MonitorState[]>(() => seed.map((m) => ({ ...m })))
  const [name, setName] = useState(initialName ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; monX: number; monY: number } | null>(null)

  const scale = computeScale(draft, CANVAS_W, CANVAS_H, PADDING)
  const rects = scale ? scaledRects(draft, scale) : []
  const enabledCount = draft.filter((m) => m.enabled).length
  const validArrangement =
    enabledCount > 0 && draft.filter((m) => m.enabled && m.primary).length === 1

  const togglePower = (m: MonitorState): void => {
    if (m.enabled && enabledCount <= 1) return // never disable the last enabled
    setDraft((d) => {
      let next = d.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x))
      // Disabling the primary hands primary to another enabled monitor.
      if (m.enabled && m.primary) {
        const heir = next.find((x) => x.enabled && x.id !== m.id)
        if (heir) next = next.map((x) => ({ ...x, primary: x.id === heir.id }))
      }
      return normalize(next)
    })
  }

  const setPrimary = (m: MonitorState): void => {
    if (!m.enabled) return
    setDraft((d) => normalize(d.map((x) => ({ ...x, primary: x.id === m.id }))))
  }

  const onPointerDown = (e: React.PointerEvent, m: MonitorState): void => {
    setSelectedId(m.id)
    if (!scale) return
    dragRef.current = { id: m.id, startX: e.clientX, startY: e.clientY, monX: m.x, monY: m.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag || !scale) return
    const dxMon = (e.clientX - drag.startX) / scale.scale
    const dyMon = (e.clientY - drag.startY) / scale.scale
    const dragged = draft.find((x) => x.id === drag.id)
    if (!dragged) return
    const proposed = { x: drag.monX + dxMon, y: drag.monY + dyMon }
    const snapped = snapDrag(dragged, draft, proposed, SNAP_PX / scale.scale)
    setDraft((d) => d.map((x) => (x.id === drag.id ? { ...x, x: snapped.x, y: snapped.y } : x)))
  }
  const onPointerUp = (): void => {
    if (!dragRef.current) return
    dragRef.current = null
    setDraft((d) => normalize(d))
  }

  return (
    <div className="no-drag flex flex-col gap-3 px-5 pb-5 pt-2">
      <div className="text-xs font-medium uppercase tracking-wider text-white/45">Edit layout</div>

      {/* Canvas */}
      <div
        className="relative rounded-2xl border border-white/10 bg-white/5"
        style={{ width: CANVAS_W, height: CANVAS_H }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {rects.map(({ m, sx, sy, sw, sh }) => {
          const disabled = !m.enabled
          const selected = m.id === selectedId
          return (
            <div
              key={m.id}
              onPointerDown={(e) => onPointerDown(e, m)}
              className={`absolute flex cursor-grab flex-col items-center justify-center overflow-visible rounded-xl border text-center transition-colors ${
                disabled ? 'border-dashed border-white/20 bg-white/[0.02] opacity-50' : 'border-white/25 bg-white/[0.10]'
              } ${selected ? 'outline outline-2 outline-accent' : ''}`}
              style={{ left: sx, top: sy, width: sw, height: sh, touchAction: 'none' }}
            >
              {m.primary && (
                <Star size={10} className="absolute right-1 top-1 text-accent" fill="rgb(var(--accent))" stroke="rgb(var(--accent))" />
              )}
              {sw >= 36 && sh >= 22 && (
                <span className="px-1 text-[8px] font-medium leading-tight text-white/75">{m.name}</span>
              )}

              {/* On-canvas toolbar for the selected monitor */}
              {selected && (
                <div
                  className="absolute -top-7 left-1/2 flex -translate-x-1/2 gap-1 rounded-lg border border-white/15 bg-neutral-900/95 px-1.5 py-1"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => togglePower(m)}
                    disabled={m.enabled && enabledCount <= 1}
                    title={m.enabled ? 'Disable' : 'Enable'}
                    className={`grid h-5 w-5 place-items-center rounded ${
                      m.enabled ? 'text-white/80 hover:bg-white/10' : 'text-white/40 hover:bg-white/10'
                    } disabled:cursor-not-allowed disabled:opacity-30`}
                  >
                    <Power size={12} />
                  </button>
                  <button
                    onClick={() => setPrimary(m)}
                    disabled={!m.enabled}
                    title="Make primary"
                    className={`grid h-5 w-5 place-items-center rounded hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 ${
                      m.primary ? 'text-accent' : 'text-white/60'
                    }`}
                  >
                    <Star size={12} fill={m.primary ? 'rgb(var(--accent))' : 'none'} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer: name + actions */}
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Profile name"
          maxLength={64}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-accent/60"
        />
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10"
        >
          <X size={13} /> Cancel
        </button>
        <button
          onClick={() => onSave(draft, name.trim())}
          disabled={!name.trim() || !validArrangement}
          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check size={13} /> Save
        </button>
        <button
          onClick={() => onApply(draft)}
          disabled={!validArrangement}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
