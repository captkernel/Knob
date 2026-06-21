import { DEFAULT_SETTINGS, type KnownDevice, type Profile, type Settings } from '@shared/types'

// Pure validation/coercion of persisted settings — no Electron/fs, so it's unit
// testable and reusable. Turns arbitrary/corrupt JSON into a valid Settings object
// without ever throwing (a hand-edited or partially-written file can't crash the app
// or feed a wrong-typed value into enrichSnapshot).

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v !== '' ? v : fallback
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

const ALIAS_MAX = 64
// Control characters (incl. DEL) — never valid in a display alias.
const CONTROL_CHARS = new RegExp('[\u0000-\u001f\u007f]', 'g')

/** Sanitize a user-set display alias: strip control chars, trim, cap length. */
function cleanAlias(val: string): string {
  return val.replace(CONTROL_CHARS, '').trim().slice(0, ALIAS_MAX)
}

function strRecord(v: unknown): Record<string, string> {
  if (!isObj(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== 'string') continue
    const clean = cleanAlias(val)
    if (clean) out[k] = clean // drop entries that sanitize to empty
  }
  return out
}
const PROFILES_MAX = 24

/** Keep only well-formed profiles; sanitize the name; cap the list length. */
function profiles(v: unknown): Profile[] {
  if (!Array.isArray(v)) return []
  const out: Profile[] = []
  for (const p of v) {
    if (
      isObj(p) &&
      typeof p.id === 'string' &&
      p.id !== '' &&
      typeof p.name === 'string' &&
      typeof p.outputId === 'string' &&
      p.outputId !== '' &&
      typeof p.inputId === 'string' &&
      p.inputId !== ''
    ) {
      const name = cleanAlias(p.name) // strip control chars, trim, cap 64
      if (name) out.push({ id: p.id, name, outputId: p.outputId, inputId: p.inputId })
    }
    if (out.length >= PROFILES_MAX) break
  }
  return out
}

function knownDevices(v: unknown): KnownDevice[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (d): d is KnownDevice =>
      isObj(d) &&
      typeof d.id === 'string' &&
      typeof d.name === 'string' &&
      (d.direction === 'playback' || d.direction === 'recording')
  )
}

export function coerceSettings(raw: unknown): Settings {
  const o = isObj(raw) ? raw : {}
  const d = DEFAULT_SETTINGS
  let windowPosition: Settings['windowPosition'] = null
  if (
    isObj(o.windowPosition) &&
    typeof o.windowPosition.x === 'number' &&
    typeof o.windowPosition.y === 'number' &&
    Number.isFinite(o.windowPosition.x) &&
    Number.isFinite(o.windowPosition.y)
  ) {
    windowPosition = { x: o.windowPosition.x, y: o.windowPosition.y }
  }
  return {
    hotkey: str(o.hotkey, d.hotkey),
    launchOnStartup: bool(o.launchOnStartup, d.launchOnStartup),
    accent: str(o.accent, d.accent),
    hiddenDeviceIds: strArray(o.hiddenDeviceIds),
    favoriteDeviceIds: strArray(o.favoriteDeviceIds),
    showOfflineDevices: bool(o.showOfflineDevices, d.showOfflineDevices),
    knownDevices: knownDevices(o.knownDevices),
    deviceAliases: strRecord(o.deviceAliases),
    windowPosition,
    profiles: profiles(o.profiles)
  }
}
