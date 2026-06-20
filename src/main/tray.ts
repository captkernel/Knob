import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { HotkeyStatus } from '@shared/types'
import { showPanel, markQuitting } from './window'

let tray: Tray | null = null

function trayIconPath(): string {
  // Packaged: resources/tray-icon.png via extraResources. Dev: ./resources. Bundled
  // paths first; cwd is only consulted in dev (never trust the launch dir packaged).
  const bundled = [
    join(process.resourcesPath ?? '', 'tray-icon.png'),
    join(app.getAppPath(), 'resources', 'tray-icon.png')
  ]
  const candidates = app.isPackaged
    ? bundled
    : [...bundled, join(process.cwd(), 'resources', 'tray-icon.png')]
  return candidates.find((p) => existsSync(p)) ?? candidates[candidates.length - 1]
}

export function createTray(onShowSettings: () => void): Tray {
  const image = nativeImage.createFromPath(trayIconPath())
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('SoundDeck — audio control')

  const menu = Menu.buildFromTemplate([
    { label: 'Show SoundDeck', click: () => showPanel() },
    { label: 'Settings…', click: () => onShowSettings() },
    { type: 'separator' },
    {
      label: 'Quit SoundDeck',
      click: () => {
        markQuitting()
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)

  // Left-click toggles the panel (Windows convention for tray utilities).
  tray.on('click', () => showPanel())

  return tray
}

/**
 * Reflect hotkey state in the tray tooltip so the user can tell — without opening
 * Settings — whether the global shortcut is live, and how to open the app if it isn't.
 */
export function setTrayHotkeyStatus(status: HotkeyStatus): void {
  if (!tray) return
  const tip = status.registered
    ? `SoundDeck — press ${status.accelerator} to open`
    : status.retrying
      ? 'SoundDeck — setting up hotkey… (click to open)'
      : `SoundDeck — hotkey "${status.accelerator}" unavailable; click to open`
  tray.setToolTip(tip)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
