import type { DisplayService } from './DisplayService'
import type { DisplaySnapshot, MonitorState, ApplyResult } from '@shared/types'
import { MockDisplayService } from './MockDisplayService'
import { MmtDisplayService } from './MmtDisplayService'
import { resolveMmtPath } from '../mmtInstaller'
import { log } from '../logger'

export type { DisplayService } from './DisplayService'

export class SwappableDisplayService implements DisplayService {
  constructor(private inner: DisplayService) {}
  get isMock(): boolean { return this.inner.isMock }
  swap(next: DisplayService): void { this.inner.dispose?.(); this.inner = next }
  getSnapshot(): Promise<DisplaySnapshot> { return this.inner.getSnapshot() }
  apply(monitors: MonitorState[]): Promise<ApplyResult> { return this.inner.apply(monitors) }
}

/**
 * Build the display backend: the real MMT backend if MultiMonitorTool.exe is already
 * present, otherwise mock (the caller downloads MMT on first run and hot-swaps via
 * {@link swapToMmtIfMock}).
 */
export function createDisplayService(): SwappableDisplayService {
  let inner: DisplayService = new MockDisplayService()
  if (process.platform === 'win32') {
    const mmtPath = resolveMmtPath()
    if (mmtPath) {
      try {
        inner = new MmtDisplayService(mmtPath)
      } catch (err) {
        log.warn('[display] MMT init failed, using mock:', err)
      }
    } else {
      log.info('[display] MultiMonitorTool.exe not found yet — starting on mock until it downloads')
    }
  }
  return new SwappableDisplayService(inner)
}

/** Swap a mock backend to the real MMT backend. Returns true if it swapped. */
export function swapToMmtIfMock(svc: SwappableDisplayService, exePath: string): boolean {
  if (!svc.isMock) return false
  try {
    svc.swap(new MmtDisplayService(exePath))
    log.info('[display] swapped to MultiMonitorTool backend')
    return true
  } catch (err) {
    log.warn('[display] swap to MMT failed:', err)
    return false
  }
}
