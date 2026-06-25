import type { MonitorState } from '@shared/types'

/** Returns an error message if the arrangement is invalid, else null. */
export function validateArrangement(monitors: MonitorState[]): string | null {
  const enabled = monitors.filter((m) => m.enabled)
  if (enabled.length === 0) return 'At least one display must stay enabled.'
  const primaries = enabled.filter((m) => m.primary)
  if (primaries.length !== 1) return 'Exactly one display must be primary.'
  return null
}

/**
 * Pure: turn a target arrangement into an ordered list of MultiMonitorTool command
 * argv arrays, applied only to currently-connected monitors. Monitors are matched by
 * stable `id`; every command targets the CONNECTED monitor's current `device`
 * (\\.\DISPLAYn), since that handle shuffles across enable/disable and the stored one
 * may be stale. Missing monitors are skipped and reported. If the captured primary is
 * disconnected, the first present enabled monitor is promoted so the result is valid.
 */
export function planApply(
  target: MonitorState[],
  connected: MonitorState[]
): { commands: string[][]; missingIds: string[]; error?: string } {
  const deviceById = new Map(connected.map((m) => [m.id, m.device]))
  const missingIds = target.filter((m) => !deviceById.has(m.id)).map((m) => m.id)
  // Re-resolve each present monitor's device from the live snapshot.
  const present = target
    .filter((m) => deviceById.has(m.id))
    .map((m) => ({ ...m, device: deviceById.get(m.id)! }))

  const enabled = present.filter((m) => m.enabled)
  if (enabled.length === 0) {
    return { commands: [], missingIds, error: 'This profile would turn off every connected display.' }
  }
  // Ensure exactly one primary among the present-enabled set.
  if (!enabled.some((m) => m.primary)) enabled[0].primary = true
  else {
    let seen = false
    for (const mon of enabled) {
      if (mon.primary && seen) mon.primary = false
      else if (mon.primary) seen = true
    }
  }

  const commands: string[][] = []
  for (const mon of enabled) commands.push(['/enable', mon.device])
  // Topology only: position + primary, NO width/height/frequency, so a disabled
  // monitor's freed bandwidth lets the survivors renegotiate their best mode.
  const blocks = enabled.map(
    (mon) => `Name=${mon.device} PositionX=${mon.x} PositionY=${mon.y}${mon.primary ? ' SetAsPrimary=1' : ''}`
  )
  commands.push(['/SetMonitors', ...blocks])
  // Disable unwanted monitors LAST so the kept ones are already positioned.
  for (const mon of present.filter((m) => !m.enabled)) commands.push(['/disable', mon.device])
  return { commands, missingIds }
}
