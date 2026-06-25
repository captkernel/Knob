import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, X, Check } from 'lucide-react'
import type { DisplayProfile, MonitorState } from '@shared/types'

interface Props {
  profiles: DisplayProfile[]
  /** Live monitor snapshot — used to snapshot into a new profile. */
  monitors: MonitorState[]
  /** Apply a saved arrangement to the OS. */
  onApply: (p: DisplayProfile) => void
  /** Persist the updated profiles list (add / remove). */
  onChange: (next: DisplayProfile[]) => void
}

export function DisplayProfilesRow({ profiles, monitors, onApply, onChange }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const openComposer = (): void => {
    setName('')
    setOpen(true)
  }

  // Phase A: "Save current" only. Disabled when name is blank or no live monitors.
  const canCreate = !!name.trim() && monitors.length > 0

  const create = (): void => {
    if (!canCreate) return
    const profile: DisplayProfile = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 64),
      monitors: monitors.map((m) => ({ ...m }))
    }
    onChange([...profiles, profile])
    setOpen(false)
  }

  const remove = (id: string): void => onChange(profiles.filter((p) => p.id !== id))

  return (
    <div className="no-drag px-5 pb-1">
      <div className="flex flex-wrap items-center gap-2">
        {profiles.map((p) => (
          <span
            key={p.id}
            className="group/chip relative inline-flex items-center overflow-hidden rounded-full border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
          >
            <button
              onClick={() => onApply(p)}
              className="max-w-[140px] truncate py-1.5 pl-3 pr-2 text-xs text-white/80"
              title={`Apply "${p.name}"`}
            >
              {p.name}
            </button>
            <button
              onClick={() => remove(p.id)}
              className="grid h-6 w-6 place-items-center rounded-full text-white/30 transition-colors hover:bg-red-500/20 hover:text-red-300"
              title="Delete profile"
            >
              <X size={12} />
            </button>
          </span>
        ))}

        <button
          onClick={() => (open ? setOpen(false) : openComposer())}
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors ${
            open
              ? 'border-accent/60 bg-accent/20 text-white'
              : 'border-dashed border-white/15 text-white/55 hover:border-white/30 hover:text-white/80'
          }`}
        >
          <Plus size={13} /> {profiles.length ? 'Profile' : 'Save profile'}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-2xl border border-white/10 bg-black/20 p-3">
              {/* Phase A: "Save current" is the only composer mode. */}
              <div className="mb-2 flex gap-1 rounded-lg bg-black/30 p-0.5 text-xs">
                <button className="flex-1 rounded-md py-1.5 font-medium transition-colors bg-white/12 text-white">
                  Save current
                </button>
                {/* Phase B: "Build manually" monitor editor mounts here */}
              </div>

              {/* Current-snapshot summary */}
              <div className="space-y-1 px-1 py-1 text-xs text-white/70">
                {monitors.length === 0 ? (
                  <p className="text-white/40">No monitors detected.</p>
                ) : (
                  monitors.map((m) => (
                    <div key={m.id} className="flex justify-between gap-2">
                      <span className="text-white/45 truncate">{m.name}</span>
                      <span className="shrink-0 text-white/55">
                        {m.width}×{m.height}
                        {m.refreshHz != null ? ` @ ${m.refreshHz}Hz` : ''}
                        {m.primary ? ' · Primary' : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                  placeholder="Profile name"
                  maxLength={64}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-accent/60"
                />
                <button
                  onClick={create}
                  disabled={!canCreate}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check size={13} /> Create
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
