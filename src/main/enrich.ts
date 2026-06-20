import type { AudioDevice, AudioSnapshot, KnownDevice, Settings } from '@shared/types'

export const MAX_KNOWN_DEVICES = 60

export interface EnrichResult {
  /** Snapshot with offline + aliased devices merged in. */
  snapshot: AudioSnapshot
  /** New roster to persist, or null when nothing meaningful changed (avoids disk thrash). */
  roster: KnownDevice[] | null
}

const keyOf = (d: { direction: string; id: string }): string => `${d.direction}|${d.id}`

/**
 * Pure enrichment of a live snapshot (no I/O, `now` injected for testability):
 *  - record/refresh every active device in a "known" roster (keyed by direction|id
 *    so a render+capture pair sharing a friendly id never collapse)
 *  - synthesize dimmed `offline: true` entries for known-but-absent devices so a
 *    starred/renamed device doesn't vanish when it sleeps or disconnects
 *  - apply user device-name aliases
 *  - cap the roster, but never evict a device the user has aliased
 *  - only emit a new roster when the device SET or its content changed (not on the
 *    per-snapshot `lastSeen` bump), so steady-state reads don't rewrite the file
 */
export function computeEnriched(snap: AudioSnapshot, cfg: Settings, now: number): EnrichResult {
  const known = new Map<string, KnownDevice>(cfg.knownDevices.map((d) => [keyOf(d), d]))
  const live = [...snap.playback, ...snap.recording]
  const activeKeys = new Set(live.map(keyOf))

  let contentChanged = false
  for (const d of live) {
    const prev = known.get(keyOf(d))
    if (!prev || prev.name !== d.name || prev.icon !== d.icon || prev.bluetooth !== d.bluetooth) {
      contentChanged = true
    }
    known.set(keyOf(d), {
      id: d.id,
      name: d.name,
      description: d.description,
      direction: d.direction,
      icon: d.icon,
      bluetooth: d.bluetooth,
      lastSeen: now
    })
  }

  // Cap: keep all aliased devices, then the most-recently-seen of the rest.
  const all = [...known.values()]
  const aliased = all.filter((d) => cfg.deviceAliases[d.id])
  const rest = all
    .filter((d) => !cfg.deviceAliases[d.id])
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, Math.max(0, MAX_KNOWN_DEVICES - aliased.length))
  const roster = [...aliased, ...rest]

  // Did the persisted set or any content change? (lastSeen alone is not "changed".)
  const beforeKeys = new Set(cfg.knownDevices.map(keyOf))
  const setChanged =
    roster.length !== cfg.knownDevices.length || roster.some((d) => !beforeKeys.has(keyOf(d)))

  const offline: AudioDevice[] = []
  for (const k of roster) {
    if (activeKeys.has(keyOf(k))) continue
    offline.push({
      id: k.id,
      name: k.name,
      description: k.description,
      direction: k.direction,
      icon: k.icon,
      isDefault: false,
      offline: true,
      bluetooth: k.bluetooth
    })
  }

  const alias = (d: AudioDevice): AudioDevice =>
    cfg.deviceAliases[d.id] ? { ...d, name: cfg.deviceAliases[d.id] } : d

  return {
    snapshot: {
      ...snap,
      playback: [...snap.playback, ...offline.filter((d) => d.direction === 'playback')].map(alias),
      recording: [...snap.recording, ...offline.filter((d) => d.direction === 'recording')].map(alias)
    },
    roster: contentChanged || setChanged ? roster : null
  }
}
