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

// NirSoft's license forbids redistributing svcl.exe inside another product, so we do
// NOT bundle it. On first run we fetch it from nirsoft.net into userData (the user
// installs the freeware themselves), and fall back to mock data until it's present.
const ZIP_URL = 'https://www.nirsoft.net/utils/svcl-x64.zip'

let state: HelperState = 'missing'
let onChange: ((s: HelperStatus) => void) | null = null

export function onHelperStatus(cb: (s: HelperStatus) => void): void {
  onChange = cb
}

export function getHelperStatus(): HelperStatus {
  return { state, mock: state !== 'ready' }
}

function setState(next: HelperState): void {
  state = next
  onChange?.(getHelperStatus())
}

export function userHelpersDir(): string {
  return join(app.getPath('userData'), 'helpers')
}

export function userSvclPath(): string {
  return join(userHelpersDir(), 'svcl.exe')
}

/**
 * First existing svcl.exe across all candidate locations, or null. Packaged builds
 * prefer the userData copy (downloaded) and NEVER consult process.cwd() (the
 * attacker-controllable launch dir). Dev runs use the repo's ./helpers.
 */
export function resolveSvclPath(): string | null {
  const candidates = app.isPackaged
    ? [
        userSvclPath(),
        join(process.resourcesPath ?? '', 'helpers', 'svcl.exe'), // legacy/none
        join(app.getAppPath(), 'helpers', 'svcl.exe')
      ]
    : [join(process.cwd(), 'helpers', 'svcl.exe'), userSvclPath()]
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
 * Ensure svcl.exe is available: if already present anywhere, mark ready; otherwise
 * download it. Returns the resolved path, or null if unavailable (non-Windows /
 * offline). Safe to call repeatedly; never throws.
 */
export async function ensureSvcl(): Promise<string | null> {
  if (process.platform !== 'win32') {
    setState('unsupported')
    return null
  }
  const existing = resolveSvclPath()
  if (existing) {
    setState('ready')
    return existing
  }
  return installSvcl()
}

/** Force a (re)download of svcl.exe into userData. Used by the in-app retry button. */
export async function installSvcl(): Promise<string | null> {
  if (process.platform !== 'win32') {
    setState('unsupported')
    return null
  }
  if (state === 'downloading') return null
  setState('downloading')

  const zipPath = join(tmpdir(), `svcl-${process.pid}.zip`)
  try {
    mkdirSync(userHelpersDir(), { recursive: true })
    log.info('[svcl] downloading helper from', ZIP_URL)
    await download(ZIP_URL, zipPath)
    await extract(zipPath, userHelpersDir())
    rmSync(zipPath, { force: true })

    if (!existsSync(userSvclPath())) {
      const found = findFile(userHelpersDir(), 'svcl.exe')
      if (found && found !== userSvclPath()) renameSync(found, userSvclPath())
    }
    if (existsSync(userSvclPath())) {
      log.info('[svcl] helper installed at', userSvclPath())
      setState('ready')
      return userSvclPath()
    }
    log.error('[svcl] extraction finished but svcl.exe not found')
    setState('failed')
    return null
  } catch (err) {
    rmSync(zipPath, { force: true })
    log.error('[svcl] helper install failed:', err)
    setState('failed')
    return null
  }
}
