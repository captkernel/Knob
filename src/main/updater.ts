import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC, type UpdateStatus } from '@shared/types'
import { mapUpdaterEvent, type UpdaterEventName, type UpdaterEventData } from './updaterMap'
import { getWindow } from './window'
import { log } from './logger'

const SIX_HOURS_MS = 6 * 60 * 60 * 1000

function broadcast(status: UpdateStatus): void {
  getWindow()?.webContents.send(IPC.updateStatusChanged, status)
}

function emit(event: UpdaterEventName, data?: UpdaterEventData): void {
  try {
    broadcast(mapUpdaterEvent(event, data))
  } catch (err) {
    log.error('[updater] broadcast failed:', err)
  }
}

function check(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    // Private-repo 404s / offline land here. Log only — never block, never popup.
    log.error('[updater] checkForUpdates failed:', err)
    emit('error', { message: String((err as Error)?.message ?? err) })
  })
}

/**
 * Wire electron-updater and begin checking. No-op unless packaged (electron-updater
 * throws without app-update.yml in dev). Never throws into the startup path.
 */
export function startUpdater(): void {
  if (!app.isPackaged) {
    log.info('[updater] skipped (not packaged)')
    return
  }
  try {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null // we route through our own logger via events

    autoUpdater.on('checking-for-update', () => emit('checking-for-update'))
    autoUpdater.on('update-available', (info) => emit('update-available', { version: info.version }))
    autoUpdater.on('update-not-available', () => emit('update-not-available'))
    autoUpdater.on('download-progress', (p) => emit('download-progress', { percent: p.percent }))
    autoUpdater.on('update-downloaded', (info) => emit('update-downloaded', { version: info.version }))
    autoUpdater.on('error', (err) => emit('error', { message: String(err?.message ?? err) }))

    check()
    setInterval(check, SIX_HOURS_MS)
    log.info('[updater] started')
  } catch (err) {
    log.error('[updater] start failed:', err)
  }
}

/** Restart and install a downloaded update. */
export function installUpdate(): void {
  try {
    autoUpdater.quitAndInstall()
  } catch (err) {
    log.error('[updater] quitAndInstall failed:', err)
  }
}
