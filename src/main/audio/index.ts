import type { AudioService } from './AudioService'
import type { AudioSnapshot } from '@shared/types'
import { MockAudioService } from './MockAudioService'
import { SvclAudioService } from './SvclAudioService'
import { resolveSvclPath } from '../svclInstaller'
import { log } from '../logger'

export type { AudioService } from './AudioService'

/**
 * Delegates to an inner backend that can be hot-swapped at runtime. This lets the app
 * start on mock data and switch to the real svcl backend the moment svcl.exe finishes
 * downloading on first run — no restart, and the IPC layer keeps its single reference.
 */
export class SwappableAudioService implements AudioService {
  constructor(private inner: AudioService) {}

  get isMock(): boolean {
    return this.inner.isMock
  }

  swap(next: AudioService): void {
    this.inner.dispose?.()
    this.inner = next
  }

  getSnapshot(): Promise<AudioSnapshot> {
    return this.inner.getSnapshot()
  }
  setDefaultDevice(deviceId: string): Promise<void> {
    return this.inner.setDefaultDevice(deviceId)
  }
  setDeviceVolume(deviceId: string, volume: number): Promise<void> {
    return this.inner.setDeviceVolume(deviceId, volume)
  }
  setDeviceMuted(deviceId: string, muted: boolean): Promise<void> {
    return this.inner.setDeviceMuted(deviceId, muted)
  }
}

/**
 * Build the audio backend: the real svcl backend if svcl.exe is already present,
 * otherwise mock (the caller downloads svcl on first run and hot-swaps via
 * {@link swapToSvclIfMock}).
 */
export function createAudioService(): SwappableAudioService {
  let inner: AudioService = new MockAudioService()
  if (process.platform === 'win32') {
    const svclPath = resolveSvclPath()
    if (svclPath) {
      try {
        inner = new SvclAudioService(svclPath)
      } catch (err) {
        log.warn('[audio] svcl init failed, using mock:', err)
      }
    } else {
      log.info('[audio] svcl.exe not found yet — starting on mock until it downloads')
    }
  }
  return new SwappableAudioService(inner)
}

/** Swap a mock backend to the real svcl backend. Returns true if it swapped. */
export function swapToSvclIfMock(audio: SwappableAudioService, svclPath: string): boolean {
  if (!audio.isMock) return false
  try {
    audio.swap(new SvclAudioService(svclPath))
    log.info('[audio] swapped to svcl backend')
    return true
  } catch (err) {
    log.warn('[audio] swap to svcl failed:', err)
    return false
  }
}
