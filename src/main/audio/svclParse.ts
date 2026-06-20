import type { AudioDevice, DeviceIconKind } from '@shared/types'

// Pure parsing/formatting helpers for svcl's `/scomma` CSV output. Kept
// dependency-free and side-effect-free so they can be unit-tested in isolation.

// Common Bluetooth audio brand/model/profile keywords (best-effort: svcl exposes
// no transport field, so we infer from the friendly name).
const BT_HINTS =
  /blue\s?tooth|\bbt\b|hands[\s-]?free|\ba2dp\b|airpod|\bbuds\b|wh-|wf-|sony|bose|jabra|\bjbl\b|beats|sennheiser|epos|expand|galaxy buds|pixel buds|soundcore|arctis|steelseries|\bqc\d|\bwf\b/i

export function isBluetooth(label: string): boolean {
  return BT_HINTS.test(label)
}

/**
 * Guard a device id before it becomes a positional svcl arg. execFile (not a shell)
 * already prevents shell injection, but a value starting with "/" would be parsed by
 * svcl as a switch — reject those and empty/non-string ids outright.
 */
export function assertDeviceId(id: string): string {
  if (typeof id !== 'string' || id.trim() === '' || id.trimStart().startsWith('/')) {
    throw new Error(`Invalid device id: ${JSON.stringify(id)}`)
  }
  return id
}

export function guessIcon(label: string): DeviceIconKind {
  const s = label.toLowerCase()
  if (/head(phone|set)|wh-|wf-|airpod|buds|arctis|beats|sennheiser/.test(s)) return 'headphone'
  if (isBluetooth(s)) return 'bluetooth'
  if (/hdmi|display|monitor|\btv\b|display audio/.test(s)) return 'hdmi'
  if (/usb|dac|yeti|fiio|scarlett|\bk7\b/.test(s)) return 'usb'
  if (/mic|capture|input|array/.test(s)) return 'mic'
  if (/speaker|realtek|output|line/.test(s)) return 'speaker'
  return 'unknown'
}

/** Parse a percent string like "76.1%" to a rounded 0..100 number, else undefined. */
export function toNum(v?: string): number | undefined {
  if (v == null) return undefined
  // Strip a percent sign and spaces; treat a single comma as a decimal separator
  // only when there is no dot (locale "76,1%"), so "1,234" stays 1234.
  let s = v.replace('%', '').trim()
  if (s === '') return undefined
  if (!s.includes('.') && (s.match(/,/g) || []).length === 1) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? Math.round(n) : undefined
}

export function truthy(v?: string): boolean {
  return /^(yes|true|1)$/i.test((v ?? '').trim())
}

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, Math.round(v)))
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, CRLF, BOM). */
export function parseCsv(text: string): Array<Record<string, string>> {
  if (!text) return []
  // Strip a leading UTF-8 BOM so the first header cell isn't "﻿Name".
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let rowHasContent = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
      rowHasContent = true
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      field = ''
      row = []
      rowHasContent = false
    } else if (c !== '\r') {
      field += c
      rowHasContent = true
    }
  }
  // Flush a final unterminated row, but ignore a pure trailing newline.
  if (field.length || rowHasContent) {
    row.push(field)
    rows.push(row)
  }
  if (rows.length === 0) return []

  const header = rows[0].map((h) => h.trim())
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {}
      header.forEach((h, idx) => (obj[h] = (r[idx] ?? '').trim()))
      return obj
    })
}

/**
 * Turn parsed svcl CSV rows into device lists. Pure: no process calls.
 * - keeps only Active physical devices (ignores Application/Subunit rows)
 * - `isDefault` requires the `Default` role to match the row's own direction
 * - de-dupes repeated Command-Line Friendly IDs within a direction
 */
export function parseDevices(csv: string): { playback: AudioDevice[]; recording: AudioDevice[] } {
  const playback: AudioDevice[] = []
  const recording: AudioDevice[] = []
  const seen = new Set<string>()

  for (const r of parseCsv(csv)) {
    if ((r['Type'] ?? '').toLowerCase() !== 'device') continue
    const id = r['Command-Line Friendly ID'] ?? ''
    if (!id) continue

    const state = (r['Device State'] ?? '').toLowerCase()
    if (state && state !== 'active') continue

    const direction: 'playback' | 'recording' = (r['Direction'] ?? '')
      .toLowerCase()
      .startsWith('capt')
      ? 'recording'
      : 'playback'

    const dedupKey = `${direction}|${id}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    // `Default` holds the role string ("Render"/"Capture"); only count it as the
    // default for THIS device if the role matches the device's direction.
    const role = (r['Default'] ?? '').trim().toLowerCase()
    const isDefault = role !== '' && (direction === 'recording' ? role.startsWith('capt') : role.startsWith('rend'))

    const label = `${r['Name'] ?? ''} ${r['Device Name'] ?? ''}`
    const device: AudioDevice = {
      id,
      name: r['Name'] || r['Device Name'] || id,
      description: r['Device Name'] || undefined,
      direction,
      icon: guessIcon(label),
      isDefault,
      volume: toNum(r['Volume Percent']),
      muted: truthy(r['Muted']),
      bluetooth: isBluetooth(label)
    }
    ;(direction === 'recording' ? recording : playback).push(device)
  }

  return { playback, recording }
}
