import { app, BrowserWindow, session } from 'electron'
import { IPC } from '@shared/types'
import { createWindow, showPanel, getWindow, markQuitting } from './window'
import { createTray, destroyTray, setTrayHotkeyStatus } from './tray'
import { ensureHotkey, onHotkeyStatus, getHotkeyStatus, unregisterAll } from './hotkey'
import { registerIpc } from './ipc'
import { createAudioService, swapToSvclIfMock } from './audio'
import { ensureSvcl, onHelperStatus } from './svclInstaller'
import { settings } from './store'
import { log } from './logger'

// Surface unexpected errors to the on-disk log and KEEP RUNNING. A single stray
// error must not silently drop the user out of the tray.
process.on('uncaughtException', (err) => log.error('[main] uncaughtException:', err))
process.on('unhandledRejection', (reason) => log.error('[main] unhandledRejection:', reason))

// Single-instance: a second launch just summons the existing panel.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showPanel())

  // Tray-only app: no dock icon, don't quit when the window hides.
  if (process.platform === 'win32') app.setAppUserModelId('com.karan.sounddeck')

  app.whenReady().then(() => {
    // Allow the renderer to enumerate audio output devices (with labels) and route
    // a test tone to a specific one via setSinkId. Scope strictly to 'media'.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(permission === 'media')
    )
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

    const audio = createAudioService()
    const { broadcastSnapshot } = registerIpc(audio)

    createWindow()

    // svcl.exe isn't bundled (NirSoft license). Stream helper status to the panel,
    // then ensure it's present — downloading it on first run and hot-swapping the
    // mock backend to the real one (no restart) when it lands.
    onHelperStatus((status) => getWindow()?.webContents.send(IPC.helperStatusChanged, status))
    void ensureSvcl().then((svclPath) => {
      if (svclPath && swapToSvclIfMock(audio, svclPath)) void broadcastSnapshot()
    })

    // Push hotkey status to the panel (banner) and the tray tooltip whenever it
    // changes, so a failed/retrying registration is never an invisible dead end.
    onHotkeyStatus((status) => {
      getWindow()?.webContents.send(IPC.hotkeyStatusChanged, status)
      setTrayHotkeyStatus(status)
    })

    const cfg = settings().get()
    // Register now; retry with backoff if it loses a startup race for the combo.
    ensureHotkey(cfg.hotkey)

    createTray(() => {
      showPanel()
      // Wait for the renderer to be ready before deep-linking to settings, so a
      // freshly-created window doesn't drop the navigate event.
      const wc = getWindow()?.webContents
      if (wc?.isLoading()) wc.once('did-finish-load', () => wc.send(IPC.navigate, 'settings'))
      else wc?.send(IPC.navigate, 'settings')
    })

    // The tray didn't exist when ensureHotkey first emitted status (it runs before
    // createTray), so on the common immediate-success path the tooltip would keep its
    // generic default. Push the current status now that the tray exists.
    setTrayHotkeyStatus(getHotkeyStatus())

    // Reflect persisted launch-on-startup into the OS setting.
    app.setLoginItemSettings({ openAtLogin: cfg.launchOnStartup, openAsHidden: true })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    log.info(`[main] SoundDeck ready — audio backend: ${audio.isMock ? 'MOCK' : 'svcl.exe'}`)
  })

  // Any quit path (tray Quit, OS logoff/shutdown, auto-update relaunch) must flip
  // the flag so the window 'close' handler doesn't veto it into a zombie process.
  app.on('before-quit', () => markQuitting())

  // Keep running in the tray after the panel is dismissed: deliberately do
  // NOT call app.quit() here. (The window is hidden, not closed, so this rarely
  // fires — but if it does, staying alive is the tray-app behaviour we want.)
  app.on('window-all-closed', () => {
    /* no-op: live in the tray */
  })

  app.on('will-quit', () => {
    unregisterAll()
    destroyTray()
  })
}
