import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, X, Check } from 'lucide-react'
import type { AudioDevice, AudioSnapshot, Profile } from '@shared/types'

interface Props {
  profiles: Profile[]
  snapshot: AudioSnapshot | null
  /** Apply a profile: set its output + input as the defaults. */
  onApply: (p: Profile) => void
  /** Persist the new profiles list. */
  onChange: (profiles: Profile[]) => void
}

type Mode = 'current' | 'manual'

const onlineDefault = (list: AudioDevice[] | undefined): AudioDevice | undefined =>
  list?.find((d) => d.isDefault && !d.offline)

export function ProfilesRow({ profiles, snapshot, onApply, onChange }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('current')
  const [name, setName] = useState('')

  const outputs = (snapshot?.playback ?? []).filter((d) => !d.offline)
  const inputs = (snapshot?.recording ?? []).filter((d) => !d.offline)
  const curOut = onlineDefault(snapshot?.playback)
  const curIn = onlineDefault(snapshot?.recording)

  // Manual-mode selections, seeded from the current defaults.
  const [outId, setOutId] = useState('')
  const [inId, setInId] = useState('')

  const openComposer = (): void => {
    setName('')
    setMode('current')
    setOutId(curOut?.id ?? outputs[0]?.id ?? '')
    setInId(curIn?.id ?? inputs[0]?.id ?? '')
    setOpen(true)
  }

  const chosenOut = mode === 'current' ? curOut?.id : outId
  const chosenIn = mode === 'current' ? curIn?.id : inId
  const canCreate = !!name.trim() && !!chosenOut && !!chosenIn

  const create = (): void => {
    if (!canCreate || !chosenOut || !chosenIn) return
    const profile: Profile = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 64),
      outputId: chosenOut,
      inputId: chosenIn
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
              <div className="mb-2 flex gap-1 rounded-lg bg-black/30 p-0.5 text-xs">
                <ModeTab active={mode === 'current'} onClick={() => setMode('current')} label="Save current" />
                <ModeTab active={mode === 'manual'} onClick={() => setMode('manual')} label="Build manually" />
              </div>

              {mode === 'current' ? (
                <div className="space-y-1 px-1 py-1 text-xs text-white/70">
                  <div className="flex justify-between gap-2">
                    <span className="text-white/45">Output</span>
                    <span className="truncate">{curOut?.name ?? '— none —'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-white/45">Input</span>
                    <span className="truncate">{curIn?.name ?? '— none —'}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <DeviceSelect label="Output" value={outId} onChange={setOutId} options={outputs} />
                  <DeviceSelect label="Input" value={inId} onChange={setInId} options={inputs} />
                </div>
              )}

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

function ModeTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
        active ? 'bg-white/12 text-white' : 'text-white/50 hover:text-white/80'
      }`}
    >
      {label}
    </button>
  )
}

function DeviceSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: string
  onChange: (id: string) => void
  options: AudioDevice[]
}): JSX.Element {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-12 shrink-0 text-white/45">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-white outline-none focus:border-accent/60"
      >
        {options.length === 0 && <option value="">— none —</option>}
        {options.map((d) => (
          <option key={d.id} value={d.id} className="bg-neutral-900">
            {d.name}
          </option>
        ))}
      </select>
    </label>
  )
}
