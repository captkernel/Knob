import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import type { AudioService } from './AudioService'
import type { AudioSnapshot } from '@shared/types'
import { assertDeviceId, clampVolume, parseDevices } from './svclParse'
import { log } from '../logger'

const execFileAsync = promisify(execFile)

/**
 * Real backend driven by NirSoft's `svcl.exe`: enumerate active playback/recording
 * devices, set the system default, and control device volume/mute.
 *
 * Robustness: a failed/timed-out svcl call NEVER takes the app down. Reads degrade
 * to the last-known snapshot (or empty); writes reject with a sanitized error that
 * the IPC layer catches.
 */
export class SvclAudioService implements AudioService {
  readonly isMock = false

  /** Last successful snapshot, returned if a later enumeration fails. */
  private lastGood: AudioSnapshot = { playback: [], recording: [], mock: false }

  constructor(private readonly exePath: string) {
    if (!existsSync(exePath)) {
      throw new Error(`svcl.exe not found at ${exePath}`)
    }
  }

  private static COLUMNS = [
    'Name',
    'Type',
    'Direction',
    'Device Name',
    'Device State',
    'Default', // holds the default ROLE ("Render"/"Capture"/"") — NOT yes/no
    'Volume Percent',
    'Muted',
    'Command-Line Friendly ID'
  ].join(',')

  private async run(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(this.exePath, args, {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024
    })
    return stdout
  }

  async getSnapshot(): Promise<AudioSnapshot> {
    try {
      // `/scomma ""` streams CSV (with header row) to stdout.
      const csv = await this.run(['/scomma', '', '/Columns', SvclAudioService.COLUMNS])
      const { playback, recording } = parseDevices(csv)
      this.lastGood = { playback, recording, mock: false }
      return this.lastGood
    } catch (err) {
      // svcl missing/slow/garbage — keep the UI alive with the last good data.
      log.error('[svcl] getSnapshot failed; returning last-known devices:', err)
      return this.lastGood
    }
  }

  async setDefaultDevice(deviceId: string): Promise<void> {
    // role "all" => Console + Multimedia + Communications
    await this.run(['/SetDefault', assertDeviceId(deviceId), 'all'])
  }

  async setDeviceVolume(deviceId: string, volume: number): Promise<void> {
    await this.run(['/SetVolume', assertDeviceId(deviceId), String(clampVolume(volume))])
  }

  async setDeviceMuted(deviceId: string, muted: boolean): Promise<void> {
    await this.run([muted ? '/Mute' : '/Unmute', assertDeviceId(deviceId)])
  }
}

