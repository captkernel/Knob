import { globalShortcut } from 'electron'
import type { HotkeyStatus } from '@shared/types'
import { togglePanel } from './window'
import { log } from './logger'
import { retrySchedule } from './hotkeyRetry'

let current: string | null = null
let status: HotkeyStatus = { accelerator: '', registered: false, retrying: false }
let timers: NodeJS.Timeout[] = []
let onChange: ((s: HotkeyStatus) => void) | null = null

/** Subscribe to status changes (renderer banner, tray tooltip, logs). */
export function onHotkeyStatus(cb: (s: HotkeyStatus) => void): void {
  onChange = cb
}

export function getHotkeyStatus(): HotkeyStatus {
  return { ...status }
}

function setStatus(next: HotkeyStatus): void {
  status = next
  onChange?.(getHotkeyStatus())
}

function clearTimers(): void {
  for (const t of timers) clearTimeout(t)
  timers = []
}

/**
 * One registration attempt. register() can return true without actually binding, so
 * we verify with isRegistered() and clean up a half-registered accelerator.
 * Does NOT touch retry timers — callers manage those.
 */
function attempt(accelerator: string): boolean {
  // Already bound to exactly this combo — nothing to do (and re-registering would
  // fail). This also makes the revert path a no-op when the old combo never dropped.
  if (current === accelerator && globalShortcut.isRegistered(accelerator)) return true
  try {
    // Register the NEW combo first; only release the old one once the new is bound.
    // This way a failed rebind never leaves the user with no working hotkey.
    const ok = globalShortcut.register(accelerator, () => togglePanel())
    if (ok && globalShortcut.isRegistered(accelerator)) {
      if (current && current !== accelerator) globalShortcut.unregister(current)
      current = accelerator
      return true
    }
    if (ok) globalShortcut.unregister(accelerator) // returned true but not bound
  } catch (err) {
    log.error('[hotkey] register threw', accelerator, err)
  }
  return false
}

/**
 * Register the summon hotkey synchronously. Returns true on success. Used by the
 * Settings change path, which wants an immediate yes/no (and reverts on failure).
 * Updates and broadcasts status. Cancels any pending startup retries.
 */
export function registerHotkey(accelerator: string): boolean {
  clearTimers()
  const ok = attempt(accelerator)
  setStatus({ accelerator, registered: ok, retrying: false })
  return ok
}

/**
 * Register at startup, retrying with backoff if the accelerator is momentarily taken
 * (the login race against other startup apps). The tray remains a guaranteed fallback
 * the whole time. Returns the immediate result; status flips to registered if a later
 * retry succeeds.
 */
export function ensureHotkey(accelerator: string): boolean {
  clearTimers()
  const ok = attempt(accelerator)
  if (ok) {
    setStatus({ accelerator, registered: true, retrying: false })
    log.info('[hotkey] registered', accelerator)
    return true
  }

  const schedule = retrySchedule()
  setStatus({ accelerator, registered: false, retrying: true })
  log.warn(`[hotkey] "${accelerator}" unavailable — retrying ${schedule.length}x (may be in use)`)

  schedule.forEach((delay, i) => {
    timers.push(
      setTimeout(() => {
        if (status.registered) return
        if (attempt(accelerator)) {
          clearTimers()
          setStatus({ accelerator, registered: true, retrying: false })
          log.info('[hotkey] registered on retry', accelerator)
        } else if (i === schedule.length - 1) {
          setStatus({ accelerator, registered: false, retrying: false })
          log.error(`[hotkey] gave up on "${accelerator}" — use the tray to open Knob`)
        }
      }, delay)
    )
  })
  return false
}

export function unregisterAll(): void {
  clearTimers()
  globalShortcut.unregisterAll()
  current = null
}
