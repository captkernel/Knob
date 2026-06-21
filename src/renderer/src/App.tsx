import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Settings as SettingsIcon, Speaker, Mic, Power, AlertTriangle, Download, Loader2 } from 'lucide-react'
import type { AudioDevice, AudioSnapshot, HelperStatus, HotkeyStatus, Settings, UpdateStatus } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { api } from './lib/api'
import { DeviceCard } from './components/DeviceCard'
import { VolumeSlider } from './components/VolumeSlider'
import { SettingsView } from './components/SettingsView'
import { UpdateToast } from './components/UpdateToast'
import { playTestTone } from './lib/testTone'
import { debounce } from './lib/debounce'

type Tab = 'output' | 'input'

const logErr = (e: unknown): void => console.error('[sounddeck]', e)

export default function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<AudioSnapshot | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus | null>(null)
  const [helper, setHelper] = useState<HelperStatus | null>(null)
  const [tab, setTab] = useState<Tab>('output')
  const [view, setView] = useState<'main' | 'settings'>('main')
  const [summonKey, setSummonKey] = useState(0)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  // Volume lock: while the user is setting a device's volume, trust the local value
  // over inbound broadcasts FOR THAT DEVICE'S VOLUME ONLY, until a snapshot confirms
  // the committed value (then release). Never locks `muted`. A fallback timer clears
  // it if the backend never reports the exact value, and it's cleared on re-summon —
  // so the lock can't get stuck and freeze a device's volume.
  const volLockRef = useRef<{ id: string; volume: number } | null>(null)
  const volLockTimer = useRef<number>(0)

  const clearVolLock = useCallback(() => {
    volLockRef.current = null
    window.clearTimeout(volLockTimer.current)
  }, [])

  // Merge an incoming snapshot, holding the locked device's volume until confirmed.
  const applySnapshot = useCallback((incoming: AudioSnapshot | null) => {
    const lock = volLockRef.current
    if (!incoming || !lock) {
      setSnapshot(incoming)
      return
    }
    let confirmed = false
    const fix = (d: AudioDevice): AudioDevice => {
      if (d.id !== lock.id) return d
      // Backend caught up (±1 for svcl's percent rounding) — accept it, release lock.
      if (d.volume !== undefined && Math.abs(d.volume - lock.volume) <= 1) {
        confirmed = true
        return d
      }
      return { ...d, volume: lock.volume } // keep the user's value, ignore stale reading
    }
    const next = { ...incoming, playback: incoming.playback.map(fix), recording: incoming.recording.map(fix) }
    if (confirmed) clearVolLock()
    setSnapshot(next)
  }, [clearVolLock])

  // ---- bootstrap + live subscriptions ----
  useEffect(() => {
    api.getSnapshot().then(applySnapshot).catch((e) => console.error('getSnapshot:', e))
    api.getSettings().then(setSettings).catch((e) => console.error('getSettings:', e))
    api.getHotkeyStatus().then(setHotkeyStatus).catch((e) => console.error('getHotkeyStatus:', e))
    api.getHelperStatus().then(setHelper).catch((e) => console.error('getHelperStatus:', e))

    const offSnap = api.onSnapshotChanged(applySnapshot)
    const offSettings = api.onSettingsChanged(setSettings)
    const offHotkey = api.onHotkeyStatusChanged(setHotkeyStatus)
    const offHelper = api.onHelperStatusChanged(setHelper)
    const offShown = api.onPanelShown(() => {
      // Re-summon is a clean slate: drop any volume lock left over from a drag that
      // ended when the panel auto-hid on blur, so stale values can't be re-applied.
      clearVolLock()
      // Hot-plug refresh: re-read devices every time the panel is summoned.
      api.getSnapshot().then(applySnapshot).catch((e) => console.error('getSnapshot:', e))
      setView('main')
      setSummonKey((k) => k + 1)
    })
    const offNav = api.onNavigate((v) => setView(v === 'settings' ? 'settings' : 'main'))
    const offUpdate = api.onUpdateStatus(setUpdate)
    return () => {
      offSnap()
      offSettings()
      offHotkey()
      offHelper()
      offShown()
      offNav()
      offUpdate()
    }
  }, [])

  // ---- live hot-plug: refresh when audio devices are added/removed ----
  // Chromium surfaces OS device changes as 'devicechange'; it can fire several
  // times per physical plug, so debounce into a single refresh down the same
  // path as summon (volume-lock + enrichment handled by applySnapshot).
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md) return
    const refresh = debounce(() => {
      api.getSnapshot().then(applySnapshot).catch((e) => console.error('devicechange refresh:', e))
    }, 400)
    md.addEventListener('devicechange', refresh)
    return () => {
      md.removeEventListener('devicechange', refresh)
      refresh.cancel()
    }
  }, [applySnapshot])

  // ---- accent theming ----
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accent)
  }, [settings.accent])

  // ---- Esc dismisses ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (view === 'settings') setView('main')
        else api.hidePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  // ---- optimistic local volume updates (snappy dragging) ----
  const patchDeviceVolume = useCallback((id: string, volume: number, muted?: boolean) => {
    setSnapshot((s) => {
      if (!s) return s
      const map = (d: AudioDevice): AudioDevice =>
        d.id === id ? { ...d, volume, ...(muted !== undefined ? { muted } : {}) } : d
      return { ...s, playback: s.playback.map(map), recording: s.recording.map(map) }
    })
  }, [])

  const visibleDevices = useCallback(
    (list: AudioDevice[]): AudioDevice[] =>
      list
        .filter((d) => !settings.hiddenDeviceIds.includes(d.id))
        .filter((d) => settings.showOfflineDevices || !d.offline)
        // active devices first, remembered/offline ones sink to the bottom
        .sort((a, b) => Number(!!a.offline) - Number(!!b.offline)),
    [settings.hiddenDeviceIds, settings.showOfflineDevices]
  )

  const toggleFavorite = useCallback(
    (id: string) => {
      const has = settings.favoriteDeviceIds.includes(id)
      const next = has
        ? settings.favoriteDeviceIds.filter((x) => x !== id)
        : [...settings.favoriteDeviceIds, id].slice(-3) // keep last 3
      api.updateSettings({ favoriteDeviceIds: next }).then(setSettings).catch(logErr)
    },
    [settings.favoriteDeviceIds]
  )

  const renameDevice = useCallback(
    (id: string, name: string) => {
      const aliases = { ...settings.deviceAliases }
      if (name) aliases[id] = name
      else delete aliases[id]
      api.updateSettings({ deviceAliases: aliases }).then(setSettings).catch(logErr)
    },
    [settings.deviceAliases]
  )

  const setDefault = useCallback((id: string) => {
    api.setDefaultDevice(id).catch(logErr)
  }, [])

  const installHelper = useCallback(() => {
    // The pushed status flips to 'downloading' (spinner) and then 'ready'/'failed'.
    api.installHelper().then(setHelper).catch(logErr)
  }, [])

  const playback = snapshot ? visibleDevices(snapshot.playback) : []
  const recording = snapshot ? visibleDevices(snapshot.recording) : []
  const devices = tab === 'output' ? playback : recording
  const defaultDevice = devices.find((d) => d.isDefault && !d.offline)

  const favorites = useMemo(() => {
    if (!snapshot) return []
    const all = [...snapshot.playback, ...snapshot.recording]
    return settings.favoriteDeviceIds
      .map((id) => all.find((d) => d.id === id))
      .filter((d): d is AudioDevice => !!d && !d.offline)
  }, [snapshot, settings.favoriteDeviceIds])

  const allDevices = snapshot ? [...snapshot.playback, ...snapshot.recording] : []
  const hotkeyFailed = !!hotkeyStatus && !hotkeyStatus.registered && !hotkeyStatus.retrying

  return (
    <div className="flex h-screen w-screen items-center justify-center p-2">
      <motion.div
        key={summonKey}
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 30, mass: 0.7 }}
        className="relative flex h-full w-full flex-col overflow-hidden rounded-panel border border-white/10 shadow-panel backdrop-blur-2xl"
        style={{
          background: 'linear-gradient(160deg, rgb(28 28 36 / 0.92), rgb(16 16 22 / 0.94))'
        }}
      >
        {/* accent glow */}
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: 'rgb(var(--accent) / 0.25)' }}
        />

        <AnimatePresence>
          {update?.state === 'ready' && (
            <UpdateToast
              version={update.version}
              onRestart={() => api.installUpdate().catch(logErr)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {view === 'settings' ? (
            <SettingsView
              key="settings"
              settings={settings}
              devices={allDevices}
              hotkeyStatus={hotkeyStatus}
              onUpdate={(patch) => api.updateSettings(patch).then(setSettings).catch(logErr)}
              onBack={() => setView('main')}
            />
          ) : (
            <motion.div
              key="main"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative flex h-full flex-col"
            >
              {/* Header */}
              <div className="drag flex items-center gap-3 px-5 pb-3 pt-5">
                <img
                  src="./tray-icon.png"
                  alt=""
                  className="h-7 w-7"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
                <div className="flex-1">
                  <h1 className="text-base font-semibold leading-tight text-white">SoundDeck</h1>
                  {helper?.mock && (
                    <span className="text-[11px] font-medium text-amber-300/80">
                      {helper.state === 'downloading' ? 'Setting up audio…' : 'Sample data'}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setView('settings')}
                  className="no-drag grid h-9 w-9 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  title="Settings"
                >
                  <SettingsIcon size={18} />
                </button>
                <button
                  onClick={() => api.quit().catch(logErr)}
                  className="no-drag grid h-9 w-9 place-items-center rounded-full text-white/60 transition-colors hover:bg-red-500/20 hover:text-red-300"
                  title="Quit SoundDeck"
                >
                  <Power size={17} />
                </button>
              </div>

              {/* Audio helper (svcl.exe) provisioning: it isn't bundled (NirSoft
                  license), so on first run it downloads. Surface progress + a retry. */}
              {helper?.mock && (
                <div className="no-drag mx-5 mb-2">
                  {helper.state === 'downloading' ? (
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
                      <Loader2 size={14} className="shrink-0 animate-spin" />
                      Setting up audio — downloading the helper…
                    </div>
                  ) : helper.state === 'unsupported' ? (
                    <div className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200/90">
                      <AlertTriangle size={14} className="shrink-0" />
                      Showing sample data — SoundDeck needs Windows to control real devices.
                    </div>
                  ) : (
                    <button
                      onClick={installHelper}
                      className="flex w-full items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-left text-xs text-amber-200/90 transition-colors hover:bg-amber-400/15"
                    >
                      <Download size={14} className="shrink-0" />
                      <span>
                        {helper.state === 'failed'
                          ? 'Couldn’t download the audio helper. Check your connection and tap to retry.'
                          : 'These are sample devices. Tap to install the audio helper and control your real devices.'}
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Hotkey-unavailable warning: the global shortcut couldn't bind (likely
                  in use by another app). Tapping it jumps to Settings to pick another. */}
              {hotkeyFailed && (
                <button
                  onClick={() => setView('settings')}
                  className="no-drag mx-5 mb-2 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-left text-xs text-amber-200/90 transition-colors hover:bg-amber-400/15"
                >
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>
                    Hotkey <span className="font-mono">{hotkeyStatus?.accelerator}</span> is unavailable
                    — it may be in use by another app. Tap to choose a different combo.
                  </span>
                </button>
              )}

              {/* Favorites */}
              {favorites.length > 0 && (
                <div className="no-drag flex flex-wrap gap-2 px-5 pb-1">
                  {favorites.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setDefault(d.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        d.isDefault
                          ? 'border-accent/60 bg-accent/20 text-white'
                          : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      <span className="max-w-[120px] truncate">{d.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Master volume for the current tab's default device */}
              {defaultDevice && (
                <div className="no-drag mx-5 my-2 rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wider text-white/45">
                      {tab === 'output' ? 'Output' : 'Input'} volume · {defaultDevice.name}
                    </span>
                  </div>
                  <VolumeSlider
                    key={defaultDevice.id}
                    value={defaultDevice.volume ?? 0}
                    muted={defaultDevice.muted}
                    onChange={(v) => {
                      volLockRef.current = { id: defaultDevice.id, volume: v }
                      patchDeviceVolume(defaultDevice.id, v)
                    }}
                    onCommit={(v) => {
                      const id = defaultDevice.id
                      volLockRef.current = { id, volume: v }
                      api.setDeviceVolume(id, v).catch((e) => console.error('setDeviceVolume:', e))
                      // Fallback release if the backend never reports exactly `v`.
                      window.clearTimeout(volLockTimer.current)
                      volLockTimer.current = window.setTimeout(() => {
                        if (volLockRef.current?.id === id) volLockRef.current = null
                      }, 2000)
                    }}
                    onToggleMute={() => {
                      const next = !defaultDevice.muted
                      patchDeviceVolume(defaultDevice.id, defaultDevice.volume ?? 0, next)
                      api.setDeviceMuted(defaultDevice.id, next).catch((e) => console.error('setDeviceMuted:', e))
                    }}
                  />
                </div>
              )}

              {/* Tabs */}
              <div className="no-drag mx-5 mb-2 flex gap-1 rounded-xl bg-black/20 p-1">
                <TabButton active={tab === 'output'} onClick={() => setTab('output')} icon={<Speaker size={15} />} label="Output" />
                <TabButton active={tab === 'input'} onClick={() => setTab('input')} icon={<Mic size={15} />} label="Input" />
              </div>

              {/* Device list */}
              <div className="no-drag flex-1 overflow-y-auto px-5 pb-5">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={tab}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-2"
                  >
                    {!snapshot ? (
                      <Empty label="Loading audio devices…" />
                    ) : devices.length ? (
                      devices.map((d) => (
                        <DeviceCard
                          key={d.id}
                          device={d}
                          favorite={settings.favoriteDeviceIds.includes(d.id)}
                          onSelect={() => setDefault(d.id)}
                          onToggleFavorite={() => toggleFavorite(d.id)}
                          onRename={(name) => renameDevice(d.id, name)}
                          onTest={
                            tab === 'output'
                              ? () =>
                                  playTestTone(
                                    [d.description, d.name].filter((s): s is string => !!s)
                                  ).catch(logErr)
                              : undefined
                          }
                        />
                      ))
                    ) : (
                      <Empty label={tab === 'output' ? 'No playback devices' : 'No recording devices'} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {tab === 'output' && devices.length > 0 && (
                <div className="no-drag px-5 pb-3 text-[11px] leading-snug text-white/35">
                  New audio follows your selection. Already-playing apps keep their device until restarted. Hover a device to play a test tone.
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors ${
        active ? 'text-white' : 'text-white/50 hover:text-white/80'
      }`}
    >
      {active && (
        <motion.span
          layoutId="tab-pill"
          className="absolute inset-0 rounded-lg bg-white/10"
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">
        {icon}
        {label}
      </span>
    </button>
  )
}

function Empty({ label }: { label: string }): JSX.Element {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 py-10 text-sm text-white/40">
      {label}
    </div>
  )
}
