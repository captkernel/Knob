import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'

interface Props {
  value: number // 0..100
  muted?: boolean
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  onToggleMute?: () => void
  compact?: boolean
}

/**
 * Glassy custom volume slider. Dragging updates live (onChange) and fires
 * onCommit on release so callers can throttle expensive backend calls.
 */
export function VolumeSlider({
  value,
  muted = false,
  onChange,
  onCommit,
  onToggleMute,
  compact = false
}: Props): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  // Keep callbacks in refs so the drag listener set is stable for the whole
  // gesture (otherwise a re-render mid-drag churns listeners and can drop pointerup).
  const onChangeRef = useRef(onChange)
  const onCommitRef = useRef(onCommit)
  onChangeRef.current = onChange
  onCommitRef.current = onCommit
  // Latest value, so a blur/cancel mid-drag can still commit it (see `cancel`).
  const valueRef = useRef(value)
  valueRef.current = value

  const safeValue = Number.isFinite(value) ? value : 0
  const pct = muted ? 0 : Math.max(0, Math.min(100, safeValue))

  const valueFromEvent = useCallback((clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return 0
    const ratio = (clientX - rect.left) / rect.width
    return Math.round(Math.max(0, Math.min(1, ratio)) * 100)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent): void => onChangeRef.current(valueFromEvent(e.clientX))
    const end = (e: PointerEvent): void => {
      setDragging(false)
      onCommitRef.current?.(valueFromEvent(e.clientX))
    }
    // If the pointer is cancelled or the window loses focus mid-drag, end the drag
    // cleanly AND commit the latest value — otherwise the caller's drag lock (keyed
    // on commit) is never released and that device's volume freezes against updates.
    const cancel = (): void => {
      setDragging(false)
      onCommitRef.current?.(valueRef.current)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [dragging, valueFromEvent])

  const VolIcon = muted || pct === 0 ? VolumeX : pct < 50 ? Volume1 : Volume2

  return (
    <div className={`no-drag flex items-center gap-3 ${compact ? '' : 'py-1'}`}>
      {onToggleMute && (
        <button
          onClick={onToggleMute}
          className={`grid place-items-center rounded-full transition-colors ${
            compact ? 'h-7 w-7' : 'h-9 w-9'
          } ${muted ? 'text-red-400 bg-red-400/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
          title={muted ? 'Unmute' : 'Mute'}
        >
          <VolIcon size={compact ? 15 : 17} />
        </button>
      )}

      <div
        ref={trackRef}
        onPointerDown={(e) => {
          setDragging(true)
          onChange(valueFromEvent(e.clientX))
        }}
        className={`group relative flex-1 cursor-pointer rounded-full bg-white/10 ${
          compact ? 'h-1.5' : 'h-2'
        }`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-75"
          style={{ width: `${pct}%`, opacity: muted ? 0.4 : 1 }}
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-md ring-2 ring-accent/60 transition-transform ${
            compact ? 'h-3 w-3' : 'h-4 w-4'
          } ${dragging ? 'scale-110' : 'group-hover:scale-110'}`}
          style={{ left: `${pct}%`, opacity: muted ? 0.5 : 1 }}
        />
      </div>

      {!compact && (
        <span className="w-9 shrink-0 text-right text-sm tabular-nums text-white/60">
          {muted ? '—' : pct}
        </span>
      )}
    </div>
  )
}
