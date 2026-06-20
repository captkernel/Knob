import { describe, it, expect } from 'vitest'
import { assertDeviceId } from '../src/main/audio/svclParse'

describe('assertDeviceId', () => {
  it('accepts a normal svcl device id', () => {
    const id = 'Realtek(R) Audio\\Device\\Speakers\\Render'
    expect(assertDeviceId(id)).toBe(id)
  })

  it('rejects empty / whitespace-only ids', () => {
    expect(() => assertDeviceId('')).toThrow()
    expect(() => assertDeviceId('   ')).toThrow()
  })

  it('rejects ids that would be parsed by svcl as a switch (leading /)', () => {
    expect(() => assertDeviceId('/SetVolume')).toThrow()
    // leading whitespace must not smuggle a switch past the guard
    expect(() => assertDeviceId('  /Mute')).toThrow()
  })

  it('rejects non-string input', () => {
    // @ts-expect-error testing runtime guard against bad callers
    expect(() => assertDeviceId(null)).toThrow()
    // @ts-expect-error testing runtime guard against bad callers
    expect(() => assertDeviceId(42)).toThrow()
  })
})
