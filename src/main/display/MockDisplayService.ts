import type { DisplayService } from './DisplayService'
import type { DisplaySnapshot, MonitorState, ApplyResult } from '@shared/types'

export class MockDisplayService implements DisplayService {
  readonly isMock = true
  private monitors: MonitorState[] = [
    { id: 'mock-laptop', device: '\\\\.\\DISPLAY1', name: 'Laptop Display', enabled: true, primary: true, x: 0, y: 0, width: 1920, height: 1200, refreshHz: 60 },
    { id: 'mock-dell', device: '\\\\.\\DISPLAY2', name: 'DELL U2719D', enabled: true, primary: false, x: 1920, y: 0, width: 2560, height: 1440, refreshHz: 144 }
  ]
  async getSnapshot(): Promise<DisplaySnapshot> {
    return { monitors: this.monitors.map((m) => ({ ...m })), mock: true }
  }
  async apply(monitors: MonitorState[]): Promise<ApplyResult> {
    const present = monitors.filter((m) => this.monitors.some((x) => x.id === m.id))
    this.monitors = this.monitors.map((m) => present.find((p) => p.id === m.id) ?? m)
    return { ok: true, appliedCount: present.length, missingIds: monitors.filter((m) => !present.includes(m)).map((m) => m.id) }
  }
}
