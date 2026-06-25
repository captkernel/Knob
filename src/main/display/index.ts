import type { DisplayService } from './DisplayService'
import type { DisplaySnapshot, MonitorState, ApplyResult } from '@shared/types'
import { MockDisplayService } from './MockDisplayService'

export type { DisplayService } from './DisplayService'

export class SwappableDisplayService implements DisplayService {
  constructor(private inner: DisplayService) {}
  get isMock(): boolean { return this.inner.isMock }
  swap(next: DisplayService): void { this.inner.dispose?.(); this.inner = next }
  getSnapshot(): Promise<DisplaySnapshot> { return this.inner.getSnapshot() }
  apply(monitors: MonitorState[]): Promise<ApplyResult> { return this.inner.apply(monitors) }
}

export function createDisplayService(): SwappableDisplayService {
  return new SwappableDisplayService(new MockDisplayService())
}
