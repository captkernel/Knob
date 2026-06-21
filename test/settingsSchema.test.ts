import { describe, it, expect } from 'vitest'
import { coerceSettings } from '../src/main/settingsSchema'
import { DEFAULT_SETTINGS } from '../src/shared/types'

describe('coerceSettings', () => {
  it('returns defaults for non-objects', () => {
    expect(coerceSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings(42)).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings([])).toEqual(DEFAULT_SETTINGS)
  })

  it('merges valid fields over defaults', () => {
    const s = coerceSettings({ hotkey: 'Control+Alt+S', launchOnStartup: true, accent: '1 2 3' })
    expect(s.hotkey).toBe('Control+Alt+S')
    expect(s.launchOnStartup).toBe(true)
    expect(s.accent).toBe('1 2 3')
  })

  it('coerces wrong-typed fields back to safe defaults (never throws downstream)', () => {
    const s = coerceSettings({
      hotkey: 123,
      launchOnStartup: 'yes',
      hiddenDeviceIds: 'not-an-array',
      favoriteDeviceIds: [1, 'keep', null],
      deviceAliases: null,
      knownDevices: 'bad',
      showOfflineDevices: 'true',
      windowPosition: { x: 'a', y: 5 }
    })
    expect(s.hotkey).toBe(DEFAULT_SETTINGS.hotkey)
    expect(s.launchOnStartup).toBe(false)
    expect(s.hiddenDeviceIds).toEqual([])
    expect(s.favoriteDeviceIds).toEqual(['keep']) // non-strings filtered out
    expect(s.deviceAliases).toEqual({})
    expect(s.knownDevices).toEqual([])
    expect(s.showOfflineDevices).toBe(DEFAULT_SETTINGS.showOfflineDevices)
    expect(s.windowPosition).toBeNull() // invalid x rejected
  })

  it('keeps a valid windowPosition', () => {
    expect(coerceSettings({ windowPosition: { x: 100, y: 200 } }).windowPosition).toEqual({ x: 100, y: 200 })
  })

  it('filters malformed knownDevices entries', () => {
    const s = coerceSettings({
      knownDevices: [
        { id: 'ok', name: 'A', direction: 'playback', icon: 'speaker', lastSeen: 1 },
        { id: 'bad-direction', name: 'B', direction: 'sideways' },
        { name: 'no-id' },
        'garbage'
      ]
    })
    expect(s.knownDevices.map((d) => d.id)).toEqual(['ok'])
  })

  it('strips non-string alias values', () => {
    const s = coerceSettings({ deviceAliases: { a: 'Good', b: 5, c: null } })
    expect(s.deviceAliases).toEqual({ a: 'Good' })
  })

  it('sanitizes alias values: strips control chars, trims, drops empties', () => {
    const s = coerceSettings({
      deviceAliases: {
        a: '  Desk Speakers  ', // surrounding whitespace trimmed
        b: 'Bad\x07Na\x1bme', // embedded BEL + ESC stripped
        c: '\x00\x01\x02', // only control chars -> sanitizes to empty -> dropped
        d: '' // empty -> dropped
      }
    })
    expect(s.deviceAliases).toEqual({ a: 'Desk Speakers', b: 'BadName' })
  })

  it('caps alias length at 64 chars', () => {
    const s = coerceSettings({ deviceAliases: { a: 'x'.repeat(100) } })
    expect(s.deviceAliases.a).toHaveLength(64)
  })

  it('defaults profiles to [] when absent or wrong-typed', () => {
    expect(coerceSettings({}).profiles).toEqual([])
    expect(coerceSettings({ profiles: 'nope' }).profiles).toEqual([])
  })

  it('keeps valid profiles and drops malformed ones', () => {
    const s = coerceSettings({
      profiles: [
        { id: 'a', name: 'Gaming', outputId: 'Out\\Render', inputId: 'In\\Capture' },
        { id: 'b', name: 'no-output', inputId: 'In\\Capture' }, // missing outputId
        { id: 'c', name: '', outputId: 'O', inputId: 'I' }, // empty name -> dropped
        { name: 'no-id', outputId: 'O', inputId: 'I' }, // missing id
        'garbage'
      ]
    })
    expect(s.profiles.map((p) => p.id)).toEqual(['a'])
    expect(s.profiles[0]).toEqual({ id: 'a', name: 'Gaming', outputId: 'Out\\Render', inputId: 'In\\Capture' })
  })

  it('sanitizes profile names (control chars stripped, trimmed, capped at 64)', () => {
    const s = coerceSettings({
      profiles: [{ id: 'a', name: '  Wo\x07rk  ' + 'y'.repeat(100), outputId: 'O', inputId: 'I' }]
    })
    expect(s.profiles[0].name.startsWith('Work')).toBe(true)
    expect(s.profiles[0].name).toHaveLength(64)
  })

  it('caps the number of profiles at 24', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      name: 'P' + i,
      outputId: 'O',
      inputId: 'I'
    }))
    expect(coerceSettings({ profiles: many }).profiles).toHaveLength(24)
  })
})
