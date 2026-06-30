import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Keyboard, Power, Palette, EyeOff, Eye, Plug, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import type { AudioDevice, HotkeyStatus, Settings } from '@shared/types'
import { deviceIcon } from '../lib/icons'
import { toAccelerator } from '../lib/accelerator'

interface Props {
  settings: Settings
  devices: AudioDevice[]
  hotkeyStatus: HotkeyStatus | null
  onUpdate: (patch: Partial<Settings>) => void
  onBack: () => void
}

const ACCENTS: { name: string; rgb: string }[] = [
  { name: 'Violet', rgb: '124 92 255' },
  { name: 'Blue', rgb: '56 130 246' },
  { name: 'Teal', rgb: '20 184 166' },
  { name: 'Green', rgb: '34 197 94' },
  { name: 'Amber', rgb: '245 158 11' },
  { name: 'Rose', rgb: '244 63 94' }
]

export function SettingsView({ settings, devices, hotkeyStatus, onUpdate, onBack }: Props): JSX.Element {
  const [capturing, setCapturing] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className="flex h-full flex-col"
    >
      <div className="drag flex items-center gap-3 px-5 pb-3 pt-5">
        <button
          onClick={onBack}
          className="no-drag grid h-9 w-9 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-lg font-semibold text-white">Settings</h2>
      </div>

      <div className="no-drag flex-1 space-y-6 overflow-y-auto px-5 pb-6">
        {/* Hotkey */}
        <Section icon={<Keyboard size={16} />} title="Summon hotkey">
          <button
            onKeyDown={(e) => {
              if (!capturing) return
              e.preventDefault()
              // Escape cancels capture (and must not bubble to the panel's Esc-dismiss).
              if (e.key === 'Escape') {
                e.nativeEvent.stopImmediatePropagation()
                setCapturing(false)
                return
              }
              const acc = toAccelerator(e)
              if (acc) {
                onUpdate({ hotkey: acc })
                setCapturing(false)
              }
              // else: keep waiting for a valid combo (ignore lone modifiers / invalid keys)
            }}
            onBlur={() => setCapturing(false)}
            onClick={() => setCapturing((c) => !c)}
            className={`w-full rounded-xl border px-4 py-3 text-left font-mono text-sm transition-colors ${
              capturing
                ? 'border-accent bg-accent/15 text-white'
                : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
            }`}
          >
            {capturing ? 'Press a key combination… (Esc to cancel)' : settings.hotkey}
          </button>
          {hotkeyStatus && !capturing && <HotkeyState status={hotkeyStatus} />}
          <p className="mt-1.5 text-xs text-white/40">
            Needs at least one modifier (Ctrl/Alt/Shift). Press the hotkey, Esc, or click away to dismiss the panel.
          </p>
        </Section>

        {/* Launch on startup */}
        <Section icon={<Power size={16} />} title="Startup">
          <Toggle
            label="Launch Knob when Windows starts"
            checked={settings.launchOnStartup}
            onChange={(v) => onUpdate({ launchOnStartup: v })}
          />
        </Section>

        {/* Accent */}
        <Section icon={<Palette size={16} />} title="Accent color">
          <div className="flex flex-wrap gap-2.5">
            {ACCENTS.map((a) => (
              <button
                key={a.rgb}
                onClick={() => onUpdate({ accent: a.rgb })}
                title={a.name}
                className={`h-9 w-9 rounded-full ring-2 transition-transform hover:scale-110 ${
                  settings.accent === a.rgb ? 'ring-white' : 'ring-transparent'
                }`}
                style={{ backgroundColor: `rgb(${a.rgb})` }}
              />
            ))}
          </div>
        </Section>

        {/* Remembered devices */}
        <Section icon={<Plug size={16} />} title="Remembered devices">
          <div className="space-y-1.5">
            <Toggle
              label="Show remembered devices when disconnected"
              checked={settings.showOfflineDevices}
              onChange={(v) => onUpdate({ showOfflineDevices: v })}
            />
            <button
              onClick={() => onUpdate({ knownDevices: [] })}
              className="flex w-full items-center gap-2 rounded-xl bg-white/[0.03] px-4 py-3 text-left text-sm text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <Plug size={15} />
              Forget remembered devices ({settings.knownDevices.length})
            </button>
          </div>
        </Section>

        {/* Hidden devices */}
        <Section icon={<EyeOff size={16} />} title="Visible devices">
          <div className="space-y-1.5">
            {devices.map((d) => {
              const hidden = settings.hiddenDeviceIds.includes(d.id)
              const Icon = deviceIcon(d.icon)
              return (
                <div
                  key={d.id}
                  className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2"
                >
                  <Icon size={16} className="text-white/50" />
                  <span className={`flex-1 truncate text-sm ${hidden ? 'text-white/35 line-through' : 'text-white/80'}`}>
                    {d.name}
                  </span>
                  <button
                    onClick={() =>
                      onUpdate({
                        hiddenDeviceIds: hidden
                          ? settings.hiddenDeviceIds.filter((x) => x !== d.id)
                          : [...settings.hiddenDeviceIds, d.id]
                      })
                    }
                    className="grid h-7 w-7 place-items-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                    title={hidden ? 'Show device' : 'Hide device'}
                  >
                    {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              )
            })}
          </div>
        </Section>
      </div>
    </motion.div>
  )
}

function HotkeyState({ status }: { status: HotkeyStatus }): JSX.Element {
  if (status.registered) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-300/90">
        <CheckCircle2 size={14} /> Active — press it anywhere to summon Knob.
      </div>
    )
  }
  if (status.retrying) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-white/55">
        <Loader2 size={14} className="animate-spin" /> Setting up the hotkey…
      </div>
    )
  }
  return (
    <div className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-300/90">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>Unavailable — likely in use by another app. Pick a different combination above. (You can always open Knob from the tray icon.)</span>
    </div>
  )
}

function Section({
  icon,
  title,
  children
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/45">
        {icon}
        {title}
      </div>
      {children}
    </section>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3 text-left"
    >
      <span className="text-sm text-white/80">{label}</span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}
