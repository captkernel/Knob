import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { log } from './logger'
import { buildClearOverridesScript } from './winAppOverrideScript'

const execFileAsync = promisify(execFile)

/**
 * Clear ALL per-application device overrides so every app follows the system default
 * again. Best-effort and non-blocking by design — callers fire-and-forget. Never
 * throws. See winAppOverrideScript.ts for what the script does and why.
 */
export async function clearAllAppDeviceOverrides(): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', buildClearOverridesScript()],
      { windowsHide: true, timeout: 8000 }
    )
  } catch (err) {
    log.error('[winAppOverride] failed to clear per-app overrides:', err)
  }
}
