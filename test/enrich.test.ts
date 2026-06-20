import { describe, it, expect } from 'vitest'
import { computeEnriched, MAX_KNOWN_DEVICES } from '../src/main/enrich'
import { DEFAULT_SETTINGS, type AudioDevice, type AudioSnapshot, type KnownDevice, type Settings } from '../src/shared/types'

const dev = (over: Partial<AudioDevice> & { id: string }): AudioDevice => ({
  name: over.id,
  direction: 'playback',
  icon: 'speaker',
  isDefault: false,
  ...over
})

const snap = (playback: AudioDevice[], recording: AudioDevice[] = []): AudioSnapshot => ({
  playback,
  recording,
  mock: false
})

const cfg = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over })

describe('computeEnriched', () => {
  it('records active devices into the roster on first sight', () => {
    const { roster } = computeEnriched(snap([dev({ id: 'a' })]), cfg(), 1000)
    expect(roster).not.toBeNull()
    expect(roster!.map((d) => d.id)).toContain('a')
    expect(roster!.find((d) => d.id === 'a')!.lastSeen).toBe(1000)
  })

  it('never marks an active device offline', () => {
    const { snapshot } = computeEnriched(snap([dev({ id: 'a' })]), cfg(), 1)
    expect(snapshot.playback.every((d) => !d.offline)).toBe(true)
  })

  it('synthesizes a dimmed offline entry for a known-but-absent device', () => {
    const known: KnownDevice = { id: 'gone', name: 'Headphones', direction: 'playback', icon: 'headphone', lastSeen: 1 }
    const { snapshot } = computeEnriched(snap([dev({ id: 'a' })]), cfg({ knownDevices: [known] }), 2)
    const off = snapshot.playback.find((d) => d.id === 'gone')
    expect(off).toBeTruthy()
    expect(off!.offline).toBe(true)
    expect(off!.isDefault).toBe(false)
  })

  it('does not write the roster when only lastSeen would change (no thrash)', () => {
    const known: KnownDevice = { id: 'a', name: 'a', direction: 'playback', icon: 'speaker', lastSeen: 1 }
    const { roster } = computeEnriched(snap([dev({ id: 'a' })]), cfg({ knownDevices: [known] }), 9999)
    expect(roster).toBeNull()
  })

  it('writes the roster when a device name/icon changes', () => {
    const known: KnownDevice = { id: 'a', name: 'Old', direction: 'playback', icon: 'speaker', lastSeen: 1 }
    const { roster } = computeEnriched(snap([dev({ id: 'a', name: 'New' })]), cfg({ knownDevices: [known] }), 2)
    expect(roster).not.toBeNull()
    expect(roster!.find((d) => d.id === 'a')!.name).toBe('New')
  })

  it('keeps render and capture devices that share a friendly id (no collapse)', () => {
    const out = dev({ id: 'shared', direction: 'playback' })
    const inp = dev({ id: 'shared', direction: 'recording', icon: 'mic' })
    const { roster, snapshot } = computeEnriched(snap([out], [inp]), cfg(), 1)
    expect(roster!.filter((d) => d.id === 'shared')).toHaveLength(2)
    // both remain active (neither wrongly synthesized as offline)
    expect(snapshot.playback.filter((d) => d.offline)).toHaveLength(0)
    expect(snapshot.recording.filter((d) => d.offline)).toHaveLength(0)
  })

  it('applies aliases without losing id/isDefault', () => {
    const { snapshot } = computeEnriched(
      snap([dev({ id: 'a', name: 'Speakers', isDefault: true })]),
      cfg({ deviceAliases: { a: 'Living Room' } }),
      1
    )
    const d = snapshot.playback.find((x) => x.id === 'a')!
    expect(d.name).toBe('Living Room')
    expect(d.isDefault).toBe(true)
  })

  it('caps the roster but never evicts an aliased device', () => {
    const many: KnownDevice[] = Array.from({ length: MAX_KNOWN_DEVICES + 5 }, (_, i) => ({
      id: `d${i}`,
      name: `d${i}`,
      direction: 'playback',
      icon: 'speaker',
      lastSeen: i // d0 oldest
    }))
    const conf = cfg({ knownDevices: many, deviceAliases: { d0: 'Pinned' } })
    const { roster } = computeEnriched(snap([]), conf, 1)
    expect(roster!.length).toBeLessThanOrEqual(MAX_KNOWN_DEVICES)
    expect(roster!.some((d) => d.id === 'd0')).toBe(true) // aliased survived despite being oldest
  })
})
