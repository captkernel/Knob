import { app } from 'electron'
import { join } from 'node:path'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { formatLogLine, type LogLevel } from './logFormat'

// Lightweight, dependency-free file logger. In a packaged build console output goes
// nowhere, so unexpected errors and key lifecycle events (hotkey registration!) would
// be invisible. This writes them to userData/logs/main.log so a user can attach the
// file to a bug report and we can actually debug it.

const MAX_BYTES = 1024 * 1024 // rotate at ~1 MB; keep one previous file

let logPath: string | null = null

function resolvePath(): string | null {
  if (logPath) return logPath
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logPath = join(dir, 'main.log')
    return logPath
  } catch {
    return null // userData not ready / unavailable — fall back to console only
  }
}

function rotateIfNeeded(path: string): void {
  try {
    if (statSync(path).size > MAX_BYTES) renameSync(path, `${path}.1`)
  } catch {
    /* file may not exist yet, or rename raced — ignore */
  }
}

function write(level: LogLevel, msg: string, args: unknown[]): void {
  const line = formatLogLine(level, msg, args, new Date())
  const path = resolvePath()
  if (path) {
    rotateIfNeeded(path)
    try {
      appendFileSync(path, line + '\n', 'utf-8')
    } catch {
      /* disk full / locked — still emit to console below */
    }
  }
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  sink(line)
}

export const log = {
  info: (msg: string, ...args: unknown[]): void => write('info', msg, args),
  warn: (msg: string, ...args: unknown[]): void => write('warn', msg, args),
  error: (msg: string, ...args: unknown[]): void => write('error', msg, args),
  /** Absolute path of the active log file (for surfacing in the UI / bug reports). */
  path: (): string | null => resolvePath()
}
