// Convert a keyboard event into a valid Electron accelerator string, or null if
// the combination can't be a global shortcut. Kept pure so it's unit-testable.
//
// The important robustness goal: never produce a token Electron will reject (e.g.
// "ArrowUp" — Electron wants "Up"), because main would then silently fail to
// register it and the user could lock themselves out of summoning the panel.

export interface KeyEventLike {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  key: string
}

// Map DOM KeyboardEvent.key values to Electron accelerator key codes.
const KEY_MAP: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  Spacebar: 'Space',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  '+': 'Plus'
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'Dead', 'Unidentified'])

export function toAccelerator(e: KeyEventLike): string | null {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')

  const key = e.key
  if (MODIFIER_KEYS.has(key)) return null // a modifier pressed alone

  let main: string | null = null
  if (key.length === 1) {
    if (/[a-z0-9]/i.test(key)) main = key.toUpperCase()
    else main = KEY_MAP[key] ?? null // most punctuation isn't a reliable accelerator
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    main = key // F1..F24
  } else {
    main = KEY_MAP[key] ?? null
  }

  if (!main) return null
  // Require at least one modifier so a bare key can't become a global shortcut
  // that swallows normal typing. (Function keys are allowed bare.)
  if (mods.length === 0 && !/^F\d/.test(main)) return null
  return [...mods, main].join('+')
}
