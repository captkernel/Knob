import type { AudioSnapshot } from '@shared/types'

/**
 * The swappable audio backend. {@link MockAudioService} provides fake data when
 * svcl.exe is unavailable; {@link SvclAudioService} drives NirSoft svcl.exe. The
 * rest of the app only ever sees this interface, so a native addon could replace
 * it later. All methods are async because real backends shell out to a process.
 */
export interface AudioService {
  /** True when the backend is producing fake data (no svcl.exe available). */
  readonly isMock: boolean

  /** Full current state: playback + recording devices. */
  getSnapshot(): Promise<AudioSnapshot>

  /** Make a device the system default (Console + Multimedia + Communications). */
  setDefaultDevice(deviceId: string): Promise<void>

  setDeviceVolume(deviceId: string, volume: number): Promise<void>
  setDeviceMuted(deviceId: string, muted: boolean): Promise<void>

  /** Release any resources / watchers. */
  dispose?(): void
}
