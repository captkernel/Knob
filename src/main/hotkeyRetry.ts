// Pure retry-timing for hotkey registration — no Electron, so it is unit-testable.
//
// Why retries exist: at login, SoundDeck (launch-on-startup) races other startup apps
// that may briefly own the same Ctrl+Alt+* combo. A one-shot register that loses the
// race leaves the user with no hotkey forever. Re-attempting over the next ~26s wins
// the common transient conflict without polling indefinitely.

/** Backoff delays (ms) for re-attempting hotkey registration after an initial failure. */
export function retrySchedule(): number[] {
  return [1000, 3000, 7000, 15000]
}
