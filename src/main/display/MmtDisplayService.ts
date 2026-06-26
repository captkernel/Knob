import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { DisplayService } from './DisplayService'
import type { DisplaySnapshot, MonitorState, ApplyResult } from '@shared/types'
import { parseMonitors } from './mmtParse'
import { planApply } from './displayPlan'
import { log } from '../logger'

const execFileAsync = promisify(execFile)

/**
 * Real backend driven by NirSoft's `MultiMonitorTool.exe`: enumerate connected
 * monitors and apply topology changes (enable/disable, position, primary).
 *
 * Robustness: a failed/timed-out MMT call NEVER takes the app down. Reads degrade
 * to the last-known snapshot (or empty); apply errors are returned as ApplyResult
 * rather than thrown.
 */
export class MmtDisplayService implements DisplayService {
  readonly isMock = false
  private lastGood: DisplaySnapshot = { monitors: [], mock: false }

  constructor(private readonly exePath: string) {
    if (!existsSync(exePath)) throw new Error(`MultiMonitorTool.exe not found at ${exePath}`)
  }

  private run(args: string[]): Promise<void> {
    return execFileAsync(this.exePath, args, { windowsHide: true, timeout: 10_000 }).then(() => undefined)
  }

  async getSnapshot(): Promise<DisplaySnapshot> {
    const out = join(tmpdir(), `mmt-${process.pid}-${Date.now()}.csv`)
    try {
      await this.run(['/scomma', out])
      const csv = readFileSync(out, 'utf-8')
      this.lastGood = { monitors: parseMonitors(csv), mock: false }
      return this.lastGood
    } catch (err) {
      log.error('[mmt] getSnapshot failed; returning last-known monitors:', err)
      return this.lastGood
    } finally {
      rmSync(out, { force: true })
    }
  }

  async apply(monitors: MonitorState[]): Promise<ApplyResult> {
    const connected = (await this.getSnapshot()).monitors // live; carries current devices
    const { commands, missingIds, error } = planApply(monitors, connected)
    if (error) return { ok: false, appliedCount: 0, missingIds, error }
    try {
      for (const cmd of commands) await this.run(cmd)
      return { ok: true, appliedCount: monitors.length - missingIds.length, missingIds }
    } catch (err) {
      log.error('[mmt] apply failed:', err)
      return { ok: false, appliedCount: 0, missingIds, error: 'Apply failed.' }
    }
  }
}
