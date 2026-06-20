import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { coerceSettings } from './settingsSchema'

/**
 * Tiny dependency-free settings store: a single JSON file in userData.
 * Hardened: atomic writes (tmp + rename), per-field validation/coercion on load,
 * and a backup of any corrupt file instead of silently wiping the user's settings.
 */
class SettingsStore {
  private filePath: string
  private tmpPath: string
  private cache: Settings

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'settings.json')
    this.tmpPath = join(dir, 'settings.json.tmp')
    this.cache = this.load()
  }

  private load(): Settings {
    let raw: unknown
    try {
      const text = readFileSync(this.filePath, 'utf-8').replace(/^﻿/, '')
      raw = JSON.parse(text)
    } catch (err) {
      // ENOENT on first run is normal; a parse error means a corrupt file — back
      // it up so the user can recover favorites/aliases rather than lose them.
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error('[settings] unreadable settings.json — backing up & resetting:', err)
        try {
          copyFileSync(this.filePath, `${this.filePath}.corrupt`)
        } catch {
          /* ignore */
        }
      }
      return { ...DEFAULT_SETTINGS }
    }
    return coerceSettings(raw)
  }

  get(): Settings {
    return { ...this.cache }
  }

  update(patch: Partial<Settings>): Settings {
    // Re-coerce the merged result so a wrong-typed patch from the IPC boundary can
    // never poison the in-memory cache or get persisted (which would later break
    // computeEnriched). coerceSettings is pure and idempotent on valid data.
    this.cache = coerceSettings({ ...this.cache, ...patch })
    try {
      // Write to a temp file then atomically replace, so a crash mid-write can
      // never truncate the real settings file.
      writeFileSync(this.tmpPath, JSON.stringify(this.cache, null, 2), 'utf-8')
      renameSync(this.tmpPath, this.filePath)
    } catch (err) {
      console.error('[settings] failed to persist:', err)
    }
    return this.get()
  }
}

let instance: SettingsStore | null = null
export function settings(): SettingsStore {
  if (!instance) instance = new SettingsStore()
  return instance
}
