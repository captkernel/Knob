import type { DisplaySnapshot, MonitorState, ApplyResult } from '@shared/types'

export interface DisplayService {
  readonly isMock: boolean
  getSnapshot(): Promise<DisplaySnapshot>
  apply(monitors: MonitorState[]): Promise<ApplyResult>
  dispose?(): void
}
