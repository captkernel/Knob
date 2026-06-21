import type { UpdateStatus } from '@shared/types'

export type UpdaterEventName =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error'

export interface UpdaterEventData {
  version?: string
  percent?: number
  message?: string
}

/**
 * Pure mapping from an electron-updater event to the renderer-facing UpdateStatus.
 * No Electron imports so it is unit-testable in isolation.
 */
export function mapUpdaterEvent(event: UpdaterEventName, data: UpdaterEventData = {}): UpdateStatus {
  switch (event) {
    case 'checking-for-update':
      return { state: 'checking' }
    case 'update-available':
      return { state: 'downloading', version: data.version, percent: 0 }
    case 'update-not-available':
      return { state: 'idle' }
    case 'download-progress':
      return { state: 'downloading', percent: Math.round(data.percent ?? 0) }
    case 'update-downloaded':
      return { state: 'ready', version: data.version }
    case 'error':
      return { state: 'error', message: data.message ?? 'Unknown update error' }
  }
}
