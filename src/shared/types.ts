// Shared contract between main (audio service), preload (IPC bridge) and renderer (UI).
// Keep this dependency-free so all three layers can import it.
//
// Scope: the CORE audio control panel — switch default output/input devices and
// control device volume. (Per-app routing was intentionally removed.)

export type DeviceDirection = 'playback' | 'recording'

export type DeviceIconKind =
  | 'speaker'
  | 'headphone'
  | 'usb'
  | 'hdmi'
  | 'bluetooth'
  | 'mic'
  | 'unknown'

export interface AudioDevice {
  /** Stable id used to set the default device (svcl "Command-Line Friendly ID"). */
  id: string
  /** Friendly display name, e.g. "Speakers (Realtek)". */
  name: string
  /** Device/interface name shown as a subtitle, e.g. "Realtek High Definition Audio". */
  description?: string
  direction: DeviceDirection
  icon: DeviceIconKind
  /** Whether this is the current default device. */
  isDefault: boolean
  /** 0..100 volume for this device, if known. */
  volume?: number
  muted?: boolean
  /** True when this device is remembered but not currently connected/active. */
  offline?: boolean
  /** True if the device transport looks like Bluetooth (best-effort). */
  bluetooth?: boolean
}

/** A device we have seen before, persisted so it survives unplug/replug. */
export interface KnownDevice {
  id: string
  name: string
  description?: string
  direction: DeviceDirection
  icon: DeviceIconKind
  bluetooth?: boolean
  /** epoch ms of when it was last seen active (stamped in main). */
  lastSeen: number
}

export interface AudioSnapshot {
  playback: AudioDevice[]
  recording: AudioDevice[]
  /** True when running on mock data (svcl.exe unavailable). */
  mock: boolean
}

/**
 * Provisioning state of the NirSoft svcl.exe helper. It is NOT bundled (its license
 * forbids redistribution); instead it's downloaded on first run into userData. The UI
 * surfaces this so a first-run download / offline failure is visible and retryable.
 */
export type HelperState =
  | 'ready' // svcl.exe present — the real audio backend is active
  | 'downloading' // fetching svcl.exe now
  | 'missing' // not present and not yet fetched (transient before download starts)
  | 'failed' // download failed (e.g. offline) — retryable
  | 'unsupported' // non-Windows — svcl will never be available

export interface HelperStatus {
  state: HelperState
  /** True while running on mock data (any state other than 'ready'). */
  mock: boolean
}

/** State of the global summon hotkey, surfaced to the UI so failures are visible. */
export interface HotkeyStatus {
  /** The configured accelerator, e.g. "Control+Alt+A". */
  accelerator: string
  /** True when the OS-level shortcut is actually bound and will summon the panel. */
  registered: boolean
  /** True while startup retry attempts are still pending. */
  retrying: boolean
}

export interface Settings {
  hotkey: string // Electron accelerator, e.g. "Control+Alt+A"
  launchOnStartup: boolean
  accent: string // "124 92 255" rgb triple for --accent
  hiddenDeviceIds: string[]
  favoriteDeviceIds: string[]
  /** Show remembered-but-disconnected devices as dimmed "offline" entries. */
  showOfflineDevices: boolean
  /** Devices seen before, kept so favorites/position survive unplug/replug. */
  knownDevices: KnownDevice[]
  /** User-renamed device labels: deviceId -> custom name. */
  deviceAliases: Record<string, string>
  /** Remembered window position; null => center on primary display. */
  windowPosition: { x: number; y: number } | null
}

export const DEFAULT_SETTINGS: Settings = {
  hotkey: 'Control+Alt+A',
  launchOnStartup: false,
  accent: '124 92 255',
  hiddenDeviceIds: [],
  favoriteDeviceIds: [],
  showOfflineDevices: true,
  knownDevices: [],
  deviceAliases: {},
  windowPosition: null
}

// ---- IPC channel names (single source of truth) --------------------------
export const IPC = {
  // renderer -> main (invoke)
  getSnapshot: 'audio:getSnapshot',
  setDefaultDevice: 'audio:setDefaultDevice',
  setDeviceVolume: 'audio:setDeviceVolume',
  setDeviceMuted: 'audio:setDeviceMuted',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  getHotkeyStatus: 'hotkey:get',
  getHelperStatus: 'helper:get',
  installHelper: 'helper:install',
  hidePanel: 'window:hide',
  quit: 'app:quit',
  // main -> renderer (send)
  snapshotChanged: 'audio:snapshotChanged',
  settingsChanged: 'settings:changed',
  hotkeyStatusChanged: 'hotkey:changed',
  helperStatusChanged: 'helper:changed',
  panelShown: 'window:shown',
  navigate: 'window:navigate'
} as const

export interface UpdateSettingsArgs {
  patch: Partial<Settings>
}
