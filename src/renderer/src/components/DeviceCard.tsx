import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AudioLines, Bluetooth, Check, Mic, Pencil, Star } from 'lucide-react'
import type { AudioDevice } from '@shared/types'
import { deviceIcon } from '../lib/icons'

interface Props {
  device: AudioDevice
  favorite: boolean
  onSelect: () => void
  onToggleFavorite: () => void
  /** Commit a new display name ('' clears the alias back to the real name). */
  onRename: (name: string) => void
  /** Play a test tone on this exact device (output devices only). */
  onTest?: () => void | Promise<unknown>
  /**
   * Start a live input-level meter for this device (input devices only). Receives
   * a level callback (0..1) and an onEnd callback (fired on auto-stop or manual
   * stop); returns a stop function. Mutually exclusive with onTest in practice.
   */
  onMeter?: (onLevel: (level: number) => void, onEnd: () => void) => () => void
}

export function DeviceCard({
  device,
  favorite,
  onSelect,
  onToggleFavorite,
  onRename,
  onTest,
  onMeter
}: Props): JSX.Element {
  const Icon = deviceIcon(device.icon)
  const offline = !!device.offline
  const [editing, setEditing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [metering, setMetering] = useState(false)
  const [level, setLevel] = useState(0)
  const meterStopRef = useRef<null | (() => void)>(null)
  const [draft, setDraft] = useState(device.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)
  // The name as it was when editing began — compared on commit so a snapshot that
  // updates `device.name` between focus and blur can't spuriously save/skip a rename.
  const editBaseRef = useRef(device.name)

  const runTest = async (): Promise<void> => {
    if (!onTest || testing) return
    setTesting(true)
    try {
      await onTest() // keep the indicator on for the real duration of the tone
    } catch (e) {
      console.error('[DeviceCard] test tone failed:', e)
    } finally {
      setTesting(false)
    }
  }

  const runMeter = (): void => {
    if (!onMeter) return
    if (meterStopRef.current) {
      // Already metering — a second click stops it early (onEnd resets the UI).
      meterStopRef.current()
      return
    }
    setMetering(true)
    meterStopRef.current = onMeter(setLevel, () => {
      setMetering(false)
      setLevel(0)
      meterStopRef.current = null
    })
  }

  // Stop any live meter if the card unmounts (e.g. tab switch or panel hide).
  useEffect(() => () => meterStopRef.current?.(), [])

  const startEditing = (): void => {
    cancelledRef.current = false
    editBaseRef.current = device.name
    setDraft(device.name) // seed once; don't clobber while the user is typing
    setEditing(true)
    requestAnimationFrame(() => inputRef.current?.select())
  }

  const commit = (): void => {
    setEditing(false)
    if (cancelledRef.current) return // Escape = cancel, not save
    const trimmed = draft.trim()
    if (trimmed !== editBaseRef.current) onRename(trimmed)
  }

  return (
    <motion.div
      layout
      role="button"
      tabIndex={0}
      onClick={() => !offline && !editing && onSelect()}
      onKeyDown={(e) => {
        if (!offline && !editing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect()
        }
      }}
      whileTap={offline || editing ? undefined : { scale: 0.98 }}
      aria-disabled={offline}
      className={`no-drag group relative flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border p-3 text-left transition-colors ${
        offline
          ? 'cursor-default border-white/5 bg-white/[0.02] opacity-50 hover:opacity-70'
          : device.isDefault
            ? 'border-accent/60 bg-accent/15 shadow-glow'
            : 'border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.06]'
      }`}
    >
      <div
        className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-xl ${
          device.isDefault && !offline ? 'bg-accent/25 text-white' : 'bg-white/5 text-white/70'
        }`}
      >
        <Icon size={21} />
        {device.bluetooth && device.icon !== 'bluetooth' && (
          <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-sky-500 text-white ring-2 ring-surface">
            <Bluetooth size={9} strokeWidth={2.5} />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') {
                  cancelledRef.current = true
                  setEditing(false)
                }
              }}
              onBlur={commit}
              className="min-w-0 flex-1 rounded-md border border-accent/60 bg-black/40 px-1.5 py-0.5 font-medium text-white outline-none"
            />
          ) : (
            <span className="truncate font-medium text-white">{device.name}</span>
          )}
          {device.isDefault && !offline && !editing && (
            <span className="shrink-0 rounded-full bg-accent/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Default
            </span>
          )}
          {offline && !editing && (
            <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">
              Offline
            </span>
          )}
        </div>
        {device.description && !editing && !metering && (
          <div className="truncate text-xs text-white/45">{device.description}</div>
        )}
        {metering && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-75 ease-out"
                // Boost the visual range: quiet speech reads clearly without clipping.
                style={{ width: `${Math.min(100, Math.round(level * 180))}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-accent">Live</span>
          </div>
        )}
      </div>

      {/* Probe: test tone (output) or live mic meter (input) */}
      {!editing && !offline && (onTest || onMeter) && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            if (onMeter) runMeter()
            else runTest()
          }}
          className={`no-drag grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all ${
            testing || metering
              ? 'text-accent opacity-100'
              : 'text-white/25 opacity-0 hover:bg-white/10 hover:text-white/80 group-hover:opacity-100'
          }`}
          title={onMeter ? 'Test this microphone' : 'Play a test tone on this device'}
        >
          {onMeter ? (
            <Mic size={15} className={metering ? 'animate-pulse' : ''} />
          ) : (
            <AudioLines size={15} className={testing ? 'animate-pulse' : ''} />
          )}
        </span>
      )}

      {/* Rename */}
      {!editing && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            startEditing()
          }}
          className="no-drag grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/25 opacity-0 transition-all hover:bg-white/10 hover:text-white/80 group-hover:opacity-100"
          title="Rename device"
        >
          <Pencil size={14} />
        </span>
      )}

      {/* Favorite */}
      {!editing && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite()
          }}
          className={`no-drag grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all ${
            favorite
              ? 'text-amber-300'
              : 'text-white/25 opacity-0 hover:text-white/70 group-hover:opacity-100'
          }`}
          title={favorite ? 'Unfavorite' : 'Add to favorites'}
        >
          <Star size={16} fill={favorite ? 'currentColor' : 'none'} />
        </span>
      )}

      {device.isDefault && !offline && !editing && (
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-white">
          <Check size={14} strokeWidth={3} />
        </span>
      )}
    </motion.div>
  )
}
