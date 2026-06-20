import { describe, it, expect } from 'vitest'
import { toAccelerator, type KeyEventLike } from '../src/renderer/src/lib/accelerator'

const ev = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  key,
  ...mods
})

describe('toAccelerator', () => {
  it('builds a standard combo', () => {
    expect(toAccelerator(ev('a', { ctrlKey: true, altKey: true }))).toBe('Control+Alt+A')
  })

  it('orders modifiers Control, Alt, Shift, Super', () => {
    expect(toAccelerator(ev('k', { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }))).toBe(
      'Control+Alt+Shift+Super+K'
    )
  })

  it('translates Arrow keys to Electron tokens (the lockout bug)', () => {
    expect(toAccelerator(ev('ArrowUp', { ctrlKey: true, altKey: true }))).toBe('Control+Alt+Up')
    expect(toAccelerator(ev('ArrowDown', { ctrlKey: true }))).toBe('Control+Down')
    expect(toAccelerator(ev('ArrowLeft', { altKey: true }))).toBe('Alt+Left')
    expect(toAccelerator(ev('ArrowRight', { metaKey: true }))).toBe('Super+Right')
  })

  it('maps space and enter', () => {
    expect(toAccelerator(ev(' ', { ctrlKey: true }))).toBe('Control+Space')
    expect(toAccelerator(ev('Enter', { ctrlKey: true }))).toBe('Control+Return')
  })

  it('rejects a lone modifier', () => {
    expect(toAccelerator(ev('Control', { ctrlKey: true }))).toBeNull()
    expect(toAccelerator(ev('Shift', { shiftKey: true }))).toBeNull()
    expect(toAccelerator(ev('Dead', { altKey: true }))).toBeNull()
  })

  it('requires at least one modifier for normal keys', () => {
    expect(toAccelerator(ev('a'))).toBeNull()
    expect(toAccelerator(ev('ArrowUp'))).toBeNull()
  })

  it('allows function keys (bare allowed)', () => {
    expect(toAccelerator(ev('F5'))).toBe('F5')
    expect(toAccelerator(ev('F12', { ctrlKey: true }))).toBe('Control+F12')
  })

  it('rejects unsupported keys instead of emitting invalid tokens', () => {
    expect(toAccelerator(ev('Unidentified', { ctrlKey: true }))).toBeNull()
    expect(toAccelerator(ev('®', { ctrlKey: true }))).toBeNull()
  })

  it('uppercases digits/letters', () => {
    expect(toAccelerator(ev('5', { ctrlKey: true }))).toBe('Control+5')
    expect(toAccelerator(ev('z', { altKey: true }))).toBe('Alt+Z')
  })
})
