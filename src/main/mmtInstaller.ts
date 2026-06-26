import { app } from 'electron'
import { join } from 'node:path'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import https from 'node:https'
import type { HelperState, HelperStatus } from '@shared/types'
import { log } from './logger'

// NirSoft's license forbids redistributing MultiMonitorTool.exe inside another product,
// so we do NOT bundle it. On first run we fetch it from nirsoft.net into userData (the
// user installs the freeware themselves), and fall back to mock data until it's present.
const ZIP_URL = 'https://www.nirsoft.net/utils/multimonitortool-x64.zip'

let state: HelperState = 'missing'
let onChange: ((s: HelperStatus) => void) | null = null

export function onMmtStatus(cb: (s: HelperStatus) => void): void {
  onChange = cb
}

export function getMmtStatus(): HelperStatus {
  return { state, mock: state !== 'ready' }
}

function setState(next: HelperState): void {
  state = next
  onChange?.(getMmtStatus())
}

function userHelpersDir(): string {
  return join(app.getPath('userData'), 'helpers')
}

export function userMmtPath(): string {
  return join(userHelpersDir(), 'MultiMonitorTool.exe')
}

/**
 * First existing MultiMonitorTool.exe across all candidate locations, or null. Packaged
 * builds prefer the userData copy (downloaded) and NEVER consult process.cwd() (the
 * attacker-controllable launch dir). Dev runs use the repo's ./helpers.
 */
export function resolveMmtPath(): string | null {
  const candidates = app.isPackaged
    ? [
        userMmtPath(),
        join(process.resourcesPath ?? '', 'helpers', 'MultiMonitorTool.exe'), // legacy/none
        join(app.getAppPath(), 'helpers', 'MultiMonitorTool.exe')
      ]
    : [join(process.cwd(), 'helpers', 'MultiMonitorTool.exe'), userMmtPath()]
  return candidates.find((p) => existsSync(p)) ?? null
}

function download(url: string, dest: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const req = https.get(url, { headers: { 'User-Agent': 'SoundDeck' } }, (res) => {
      const code = res.statusCode ?? 0
      if (code >= 300 && code < 400 && res.headers.location) {
        file.close()
        rmSync(dest, { force: true })
        if (redirects >= 5) return reject(new Error('Too many redirects'))
        return resolve(download(res.headers.location, dest, redirects + 1))
      }
      if (code !== 200) {
        file.close()
        rmSync(dest, { force: true })
        return reject(new Error(`HTTP ${code} for ${url}`))
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    })
    req.on('error', (err) => {
      file.close()
      rmSync(dest, { force: true })
      reject(err)
    })
  })
}

function findFile(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const hit = findFile(full, name)
      if (hit) return hit
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full
    }
  }
  return null
}

function extract(zipPath: string, destDir: string): Promise<void> {
  // PowerShell's Expand-Archive ships on every Windows 10/11 box (no npm dep).
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`
      ],
      { windowsHide: true }
    )
    ps.on('error', reject)
    ps.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Expand-Archive exited ${code}`))))
  })
}

/**
 * Ensure MultiMonitorTool.exe is available: if already present anywhere, mark ready;
 * otherwise download it. Returns the resolved path, or null if unavailable (non-Windows /
 * offline). Safe to call repeatedly; never throws.
 */
export async function ensureMmt(): Promise<string | null> {
  if (process.platform !== 'win32') {
    setState('unsupported')
    return null
  }
  const existing = resolveMmtPath()
  if (existing) {
    setState('ready')
    return existing
  }
  return installMmt()
}

/** Force a (re)download of MultiMonitorTool.exe into userData. Used by the in-app retry button. */
export async function installMmt(): Promise<string | null> {
  if (process.platform !== 'win32') {
    setState('unsupported')
    return null
  }
  if (state === 'downloading') return null
  setState('downloading')

  const zipPath = join(tmpdir(), `mmt-${process.pid}.zip`)
  try {
    mkdirSync(userHelpersDir(), { recursive: true })
    log.info('[mmt] downloading helper from', ZIP_URL)
    await download(ZIP_URL, zipPath)
    await extract(zipPath, userHelpersDir())
    rmSync(zipPath, { force: true })

    if (!existsSync(userMmtPath())) {
      const found = findFile(userHelpersDir(), 'MultiMonitorTool.exe')
      if (found && found !== userMmtPath()) renameSync(found, userMmtPath())
    }
    if (existsSync(userMmtPath())) {
      log.info('[mmt] helper installed at', userMmtPath())
      setState('ready')
      return userMmtPath()
    }
    log.error('[mmt] extraction finished but MultiMonitorTool.exe not found')
    setState('failed')
    return null
  } catch (err) {
    rmSync(zipPath, { force: true })
    log.error('[mmt] helper install failed:', err)
    setState('failed')
    return null
  }
}
