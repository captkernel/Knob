import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/types'
import { settings } from './store'
import { log } from './logger'

const rendererUrl = process.env['ELECTRON_RENDERER_URL']

const PANEL_WIDTH = 760
const PANEL_HEIGHT = 600

let win: BrowserWindow | null = null
let isQuitting = false
let lastShownAt = 0
let moveTimer: NodeJS.Timeout | null = null

export function markQuitting(): void {
  isQuitting = true
  // Flush a pending debounced position write so a last-moment drag isn't lost.
  if (moveTimer) {
    clearTimeout(moveTimer)
    moveTimer = null
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition()
      settings().update({ windowPosition: { x, y } })
    }
  }
}

export function getWindow(): BrowserWindow | null {
  return win
}

export function createWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')

  // Open external links in the user's browser — only safe web schemes.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Dismiss when focus is lost (clicking outside the panel). Ignore the brief
  // blur that can fire right after show, and keep it open while DevTools is open.
  win.on('blur', () => {
    if (Date.now() - lastShownAt < 250) return
    if (!win?.webContents.isDevToolsOpened()) hidePanel()
  })

  // Persist position when the user drags the panel (debounced — drags fire many
  // 'moved' events and we don't want a synchronous disk write on each).
  win.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return
      const [x, y] = win.getPosition()
      settings().update({ windowPosition: { x, y } })
    }, 400)
  })

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      hidePanel()
    }
  })

  const load = rendererUrl
    ? win.loadURL(rendererUrl)
    : win.loadFile(join(__dirname, '../renderer/index.html'))
  load.catch((err) => log.error('[window] failed to load renderer:', err))

  return win
}

function positionPanel(): void {
  if (!win) return
  const saved = settings().get().windowPosition
  // Anchor to the display under the saved point (if any) so a remembered position
  // is clamped within ITS monitor, not whichever one the cursor happens to be on.
  const anchor = saved ?? screen.getCursorScreenPoint()
  const { x: wx, y: wy, width, height } = screen.getDisplayNearestPoint(anchor).workArea

  let x = saved ? saved.x : Math.round(wx + (width - PANEL_WIDTH) / 2)
  let y = saved ? saved.y : Math.round(wy + (height - PANEL_HEIGHT) / 2)
  // Clamp fully into the chosen display's work area.
  x = Math.max(wx, Math.min(x, wx + width - PANEL_WIDTH))
  y = Math.max(wy, Math.min(y, wy + height - PANEL_HEIGHT))
  win.setPosition(x, y)
}

export function showPanel(): void {
  try {
    if (!win || win.isDestroyed()) createWindow()
  } catch (err) {
    log.error('[window] createWindow failed:', err)
    return
  }
  if (!win) return
  positionPanel()
  lastShownAt = Date.now()
  win.show()
  win.focus()
  // If the window was just (re)created, its renderer hasn't attached listeners yet —
  // wait for load so the panelShown event isn't dropped (mirrors the tray deep-link).
  const wc = win.webContents
  if (wc.isLoading()) wc.once('did-finish-load', () => wc.send(IPC.panelShown))
  else wc.send(IPC.panelShown)
}

export function hidePanel(): void {
  if (win && win.isVisible()) win.hide()
}

export function togglePanel(): void {
  if (win && win.isVisible()) hidePanel()
  else showPanel()
}
