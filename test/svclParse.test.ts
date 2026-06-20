import { describe, it, expect } from 'vitest'
import {
  parseCsv,
  toNum,
  truthy,
  isBluetooth,
  guessIcon,
  clampVolume,
  parseDevices
} from '../src/main/audio/svclParse'

const COLS = 'Name,Type,Direction,Device Name,Device State,Default,Volume Percent,Muted,Command-Line Friendly ID'
const row = (cells: string[]): string => cells.join(',')

describe('parseCsv', () => {
  it('returns [] for empty / header-only / whitespace input', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('a,b,c')).toEqual([]) // header only
    expect(parseCsv('a,b,c\n   ')).toEqual([]) // blank data row filtered
  })

  it('parses CRLF and LF identically and ignores a trailing newline', () => {
    const lf = 'A,B\n1,2\n3,4'
    const crlf = 'A,B\r\n1,2\r\n3,4\r\n'
    expect(parseCsv(lf)).toEqual(parseCsv(crlf))
    expect(parseCsv(crlf)).toEqual([
      { A: '1', B: '2' },
      { A: '3', B: '4' }
    ])
  })

  it('handles quoted fields with commas, escaped quotes, and newlines', () => {
    const csv = 'Name,Note\n"Speakers, rear","He said ""hi"""\n"two\nlines",ok'
    expect(parseCsv(csv)).toEqual([
      { Name: 'Speakers, rear', Note: 'He said "hi"' },
      { Name: 'two\nlines', Note: 'ok' }
    ])
  })

  it('strips a leading UTF-8 BOM from the header', () => {
    const rows = parseCsv('﻿Name,Type\nSpeakers,Device')
    expect(rows[0].Name).toBe('Speakers')
    expect(rows[0]['﻿Name']).toBeUndefined()
  })

  it('fills missing trailing columns and drops extras safely', () => {
    expect(parseCsv('A,B,C\n1,2')).toEqual([{ A: '1', B: '2', C: '' }])
    expect(parseCsv('A,B\n1,2,3')).toEqual([{ A: '1', B: '2' }])
  })
})

describe('toNum', () => {
  it('parses percent strings to rounded numbers', () => {
    expect(toNum('76.1%')).toBe(76)
    expect(toNum('100%')).toBe(100)
    expect(toNum('0%')).toBe(0)
  })
  it('treats a single comma as a decimal separator (locale percents are 0..100)', () => {
    expect(toNum('76,1%')).toBe(76)
    expect(toNum('1,5')).toBe(2) // 1.5 rounds to 2
    expect(toNum('12,345')).toBe(12) // 12.345 -> 12 (percent domain, never thousands)
  })
  it('returns undefined for empty / undefined / non-numeric', () => {
    expect(toNum('')).toBeUndefined()
    expect(toNum(undefined)).toBeUndefined()
    expect(toNum('abc')).toBeUndefined()
  })
})

describe('truthy', () => {
  it('treats Yes/true/1 (case-insensitive, trimmed) as true', () => {
    for (const v of ['Yes', 'yes', 'YES', ' yes ', 'true', '1']) expect(truthy(v)).toBe(true)
  })
  it('treats No/empty/other as false', () => {
    for (const v of ['No', '', undefined, '2', 'nope']) expect(truthy(v)).toBe(false)
  })
})

describe('clampVolume', () => {
  it('clamps to 0..100 and rounds; NaN -> 0', () => {
    expect(clampVolume(50.4)).toBe(50)
    expect(clampVolume(-10)).toBe(0)
    expect(clampVolume(150)).toBe(100)
    expect(clampVolume(NaN)).toBe(0)
    expect(clampVolume(Infinity)).toBe(0)
  })
})

describe('isBluetooth / guessIcon', () => {
  it('detects bluetooth devices by name hints', () => {
    expect(isBluetooth('Sony WH-1000XM5')).toBe(true)
    expect(isBluetooth('Jabra Evolve 65')).toBe(true)
    expect(isBluetooth('Realtek Speakers')).toBe(false)
  })
  it('maps names to icons with headphone before bluetooth', () => {
    expect(guessIcon('Sony WH-1000XM5 Headphones')).toBe('headphone')
    expect(guessIcon('Jabra Speak')).toBe('bluetooth')
    expect(guessIcon('LG QHD HDMI')).toBe('hdmi')
    expect(guessIcon('FiiO K7 USB DAC')).toBe('usb')
    expect(guessIcon('Microphone Array')).toBe('mic')
    expect(guessIcon('Realtek Speakers')).toBe('speaker')
    expect(guessIcon('Mystery Box 9000')).toBe('unknown')
  })
})

describe('parseDevices', () => {
  const csv = [
    COLS,
    row(['Speakers', 'Device', 'Render', 'Realtek(R) Audio', 'Active', 'Render', '76.1%', 'No', 'id-spk']),
    row(['Headphones', 'Device', 'Render', 'USB Audio', 'Active', '', '100%', 'No', 'id-hp']),
    row(['Mic', 'Device', 'Capture', 'Realtek(R) Audio', 'Active', 'Capture', '50%', 'Yes', 'id-mic']),
    row(['Old Speaker', 'Device', 'Render', 'X', 'Disabled', '', '0%', 'No', 'id-old']),
    row(['System Sounds', 'Application', 'Render', 'Realtek(R) Audio', '', '', '100%', 'No', 'id-app']),
    row(['Sub', 'Subunit', 'Render', 'X', '', '', '50%', 'No', 'id-sub'])
  ].join('\n')

  it('keeps only Active device rows (no Application/Subunit/Disabled)', () => {
    const { playback, recording } = parseDevices(csv)
    expect(playback.map((d) => d.id)).toEqual(['id-spk', 'id-hp'])
    expect(recording.map((d) => d.id)).toEqual(['id-mic'])
  })

  it('marks default only when the role matches the direction', () => {
    const { playback, recording } = parseDevices(csv)
    expect(playback.find((d) => d.id === 'id-spk')?.isDefault).toBe(true)
    expect(playback.find((d) => d.id === 'id-hp')?.isDefault).toBe(false)
    expect(recording.find((d) => d.id === 'id-mic')?.isDefault).toBe(true)
  })

  it('does NOT mark a playback device default from a Capture role', () => {
    const weird = [
      COLS,
      row(['Speakers', 'Device', 'Render', 'X', 'Active', 'Capture', '50%', 'No', 'id-x'])
    ].join('\n')
    expect(parseDevices(weird).playback[0].isDefault).toBe(false)
  })

  it('de-dupes a repeated friendly id within a direction', () => {
    const dup = [
      COLS,
      row(['Speakers', 'Device', 'Render', 'X', 'Active', 'Render', '50%', 'No', 'id-dup']),
      row(['Speakers', 'Device', 'Render', 'X', 'Active', '', '60%', 'No', 'id-dup'])
    ].join('\n')
    expect(parseDevices(dup).playback).toHaveLength(1)
  })

  it('parses volume/muted/bluetooth fields', () => {
    const { playback, recording } = parseDevices(csv)
    expect(playback.find((d) => d.id === 'id-spk')?.volume).toBe(76)
    expect(recording[0].muted).toBe(true)
    expect(playback.find((d) => d.id === 'id-hp')?.bluetooth).toBe(false) // "Headphones USB Audio" has no BT hint
  })

  it('flags a Bluetooth device from its name', () => {
    const bt = [COLS, row(['Headset', 'Device', 'Render', 'Sony WH-1000XM5', 'Active', '', '50%', 'No', 'id-bt'])].join('\n')
    expect(parseDevices(bt).playback[0].bluetooth).toBe(true)
  })
})
