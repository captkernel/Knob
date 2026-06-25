import { ipcMain, app } from 'electron'
import { IPC, type AudioSnapshot, type Settings, type UpdateSettingsArgs, type DisplaySnapshot, type ApplyResult, type MonitorState } from '@shared/types'
import { type SwappableAudioService, swapToSvclIfMock } from './audio'
import { type SwappableDisplayService, swapToMmtIfMock } from './display'
import { getMmtStatus, ensureMmt } from './mmtInstaller'
import { settings } from './store'
import { getWindow, hidePanel, markQuitting } from './window'
import { registerHotkey, getHotkeyStatus } from './hotkey'
import { getHelperStatus, installSvcl } from './svclInstaller'
import { log } from './logger'
import { installUpdate } from './updater'
import { computeEnriched } from './enrich'
import { clearAllAppDeviceOverrides } from './winAppOverride'

/** Enrich a live snapshot and persist roster changes (only when meaningful). */
function enrichSnapshot(snap: AudioSnapshot): AudioSnapshot {
  const { snapshot, roster } = computeEnriched(snap, settings().get(), Date.now())
  if (roster) settings().update({ knownDevices: roster })
  return snapshot
}

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.trim() !== '' && !id.trimStart().startsWith('/')
}

/**
 * Wire every renderer->main action. All audio mutations funnel through the
 * AudioService; after each one we ALWAYS re-broadcast a fresh snapshot (even on
 * failure) so the UI re-syncs to ground truth and never gets stuck on an
 * optimistic value. No handler is allowed to throw past the IPC boundary.
 */
export function registerIpc(audio: SwappableAudioService, display: SwappableDisplayService): { broadcastSnapshot: () => Promise<void> } {
  const broadcastSnapshot = async (): Promise<void> => {
    try {
      const snap = enrichSnapshot(await audio.getSnapshot())
      getWindow()?.webContents.send(IPC.snapshotChanged, snap)
    } catch (err) {
      log.error('[ipc] broadcastSnapshot failed:', err)
    }
  }

  const broadcastDisplaySnapshot = async (): Promise<void> => {
    try {
      getWindow()?.webContents.send(IPC.displaySnapshotChanged, await display.getSnapshot())
    } catch (err) {
      log.error('[ipc] broadcastDisplaySnapshot failed:', err)
    }
  }

  ipcMain.handle(IPC.getSnapshot, async (): Promise<AudioSnapshot> => {
    try {
      return enrichSnapshot(await audio.getSnapshot())
    } catch (err) {
      log.error('[ipc] getSnapshot failed:', err)
      return { playback: [], recording: [], mock: false }
    }
  })

  ipcMain.handle(IPC.setDefaultDevice, async (_e, deviceId: unknown) => {
    if (!isValidId(deviceId)) return
    try {
      await audio.setDefaultDevice(deviceId)
      // Picking an OUTPUT device makes it govern every app: clear stray per-app
      // device overrides so nothing keeps playing on a previously-pinned device.
      // Fire-and-forget so the UI updates instantly (it applies to apps' next stream).
      if (/\\Render$/i.test(deviceId)) {
        clearAllAppDeviceOverrides().catch((e) => log.error('[ipc] clear overrides:', e))
      }
    } catch (err) {
      log.error('[ipc] setDefaultDevice failed:', err)
    } finally {
      await broadcastSnapshot()
    }
  })

  ipcMain.handle(IPC.setDeviceVolume, async (_e, deviceId: unknown, volume: unknown) => {
    if (!isValidId(deviceId) || typeof volume !== 'number' || !Number.isFinite(volume)) return
    try {
      await audio.setDeviceVolume(deviceId, volume)
    } catch (err) {
      log.error('[ipc] setDeviceVolume failed:', err)
    } finally {
      // Broadcast the authoritative post-set snapshot. The renderer holds a volume
      // lock until it sees this value, so this confirms (and releases) the lock
      // rather than fighting the slider; on failure it re-syncs to ground truth.
      await broadcastSnapshot()
    }
  })

  ipcMain.handle(IPC.setDeviceMuted, async (_e, deviceId: unknown, muted: unknown) => {
    if (!isValidId(deviceId) || typeof muted !== 'boolean') return
    try {
      await audio.setDeviceMuted(deviceId, muted)
    } catch (err) {
      log.error('[ipc] setDeviceMuted failed:', err)
    } finally {
      await broadcastSnapshot()
    }
  })

  // ---- settings ----
  ipcMain.handle(IPC.getSettings, (): Settings => settings().get())

  ipcMain.handle(IPC.getHotkeyStatus, () => getHotkeyStatus())

  // ---- svcl helper provisioning (downloaded on first run, not bundled) ----
  ipcMain.handle(IPC.getHelperStatus, () => getHelperStatus())

  ipcMain.handle(IPC.installHelper, async () => {
    const path = await installSvcl()
    // On success, hot-swap the mock backend to the real one and refresh the UI.
    if (path && swapToSvclIfMock(audio, path)) await broadcastSnapshot()
    return getHelperStatus()
  })

  ipcMain.handle(IPC.updateSettings, (_e, args: UpdateSettingsArgs): Settings => {
    const patch = args?.patch
    if (!patch || typeof patch !== 'object') return settings().get()
    const before = settings().get()
    let next = settings().update(patch)

    if (patch.hotkey && patch.hotkey !== before.hotkey) {
      const ok = registerHotkey(patch.hotkey)
      if (!ok) {
        // Reject an unregisterable hotkey: revert and tell the renderer.
        next = settings().update({ hotkey: before.hotkey })
        registerHotkey(before.hotkey)
        getWindow()?.webContents.send(IPC.settingsChanged, next)
        return next
      }
    }
    if (patch.launchOnStartup !== undefined && patch.launchOnStartup !== before.launchOnStartup) {
      try {
        app.setLoginItemSettings({ openAtLogin: patch.launchOnStartup, openAsHidden: true })
      } catch (err) {
        log.error('[ipc] setLoginItemSettings failed:', err)
      }
    }
    getWindow()?.webContents.send(IPC.settingsChanged, next)
    return next
  })

  ipcMain.handle(IPC.hidePanel, () => hidePanel())

  ipcMain.handle(IPC.quit, () => {
    markQuitting()
    app.quit()
  })

  ipcMain.handle(IPC.installUpdate, () => {
    installUpdate()
  })

  // ---- display ----
  ipcMain.handle(IPC.getDisplaySnapshot, async (): Promise<DisplaySnapshot> => {
    try { return await display.getSnapshot() }
    catch (err) { log.error('[ipc] getDisplaySnapshot failed:', err); return { monitors: [], mock: false } }
  })

  ipcMain.handle(IPC.getDisplayHelperStatus, () => getMmtStatus())

  // Lazy: the renderer calls this when the Display tab first opens. Idempotent —
  // downloads MultiMonitorTool only if missing, then hot-swaps the mock backend.
  ipcMain.handle(IPC.ensureDisplayHelper, async () => {
    const path = await ensureMmt()
    if (path && swapToMmtIfMock(display, path)) await broadcastDisplaySnapshot()
    return getMmtStatus()
  })

  ipcMain.handle(IPC.applyDisplay, async (_e, arg: unknown): Promise<ApplyResult> => {
    try {
      let monitors: MonitorState[] | undefined
      if (typeof arg === 'string') {
        const prof = settings().get().displayProfiles.find((p) => p.id === arg)
        monitors = prof?.monitors
      } else if (Array.isArray(arg)) {
        monitors = arg as MonitorState[]
      }
      if (!monitors || monitors.length === 0) {
        return { ok: false, appliedCount: 0, missingIds: [], error: 'Nothing to apply.' }
      }
      return await display.apply(monitors)
    } catch (err) {
      log.error('[ipc] applyDisplay failed:', err)
      return { ok: false, appliedCount: 0, missingIds: [], error: 'Apply failed.' }
    } finally {
      await broadcastDisplaySnapshot()
    }
  })

  return { broadcastSnapshot }
}
