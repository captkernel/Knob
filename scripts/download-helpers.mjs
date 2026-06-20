// Downloads the NirSoft `svcl.exe` CLI into ./helpers on postinstall.
//
// Why this exists: NirSoft's license forbids redistributing its tools bundled
// inside another product, so we do NOT commit the binary. Instead each install
// fetches it directly from nirsoft.net into a gitignored folder. See README.
//
// Safe to re-run: skips download if the binary already exists. Never fails the
// install — if there is no network, it warns and the app falls back to mock data.

import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import https from 'node:https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const helpersDir = join(root, 'helpers')
const exePath = join(helpersDir, 'svcl.exe')

// svcl ships as a zip; we grab the 64-bit build.
const ZIP_URL = 'https://www.nirsoft.net/utils/svcl-x64.zip'

function log(msg) {
  console.log(`[download-helpers] ${msg}`)
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const req = https.get(url, { headers: { 'User-Agent': 'SoundDeck-setup' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        rmSync(dest, { force: true })
        if (redirects >= 5) return reject(new Error('Too many redirects'))
        return resolve(download(res.headers.location, dest, redirects + 1))
      }
      if (res.statusCode !== 200) {
        file.close()
        rmSync(dest, { force: true })
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve(dest)))
    })
    req.on('error', (err) => {
      file.close()
      rmSync(dest, { force: true })
      reject(err)
    })
  })
}

// Recursively find a file by name under `dir` (svcl zips have historically been flat,
// but a future nested layout shouldn't silently degrade us to mock data).
function findFile(dir, name) {
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

function unzip(zipPath, destDir) {
  // Use PowerShell's Expand-Archive — available on every Windows 10/11 box.
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`
    ],
    { stdio: 'inherit' }
  )
  if (result.status !== 0) throw new Error('Expand-Archive failed')
}

async function main() {
  if (process.platform !== 'win32') {
    log('Not Windows — skipping svcl.exe download (app will run on mock data).')
    return
  }
  if (existsSync(exePath)) {
    log('svcl.exe already present — skipping.')
    return
  }

  mkdirSync(helpersDir, { recursive: true })
  const zipPath = join(tmpdir(), `svcl-${process.pid}.zip`)

  try {
    log(`Downloading svcl from ${ZIP_URL} ...`)
    await download(ZIP_URL, zipPath)
    log('Extracting ...')
    unzip(zipPath, helpersDir)
    rmSync(zipPath, { force: true })
    if (!existsSync(exePath)) {
      // Not at the top level — search any nested folders the zip may have created.
      const found = findFile(helpersDir, 'svcl.exe')
      if (found) renameSync(found, exePath)
    }
    if (existsSync(exePath)) {
      log('svcl.exe ready in ./helpers ✓')
    } else {
      log('WARNING: extraction completed but svcl.exe not found. Place it in ./helpers manually.')
    }
  } catch (err) {
    log(`WARNING: could not fetch svcl.exe (${err.message}).`)
    log('The app will run on MOCK audio data until you place svcl.exe in ./helpers.')
    log('Manual download: https://www.nirsoft.net/utils/sound_volume_command_line.html')
  }
}

main()
