// Pure log-line formatting — no Electron/fs imports, so it is unit-testable and
// reusable by the file logger. (Mirrors how svclParse.ts isolates pure parsing.)

export type LogLevel = 'info' | 'warn' | 'error'

/** Serialize one extra argument for the log line, never throwing. */
export function renderArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

/** Format one log line: `<iso> <LEVEL> <msg> <args...>`. */
export function formatLogLine(level: LogLevel, msg: string, args: unknown[], at: Date): string {
  const tag = level.toUpperCase().padEnd(5, ' ')
  const extra = args.length ? ' ' + args.map(renderArg).join(' ') : ''
  return `${at.toISOString()} ${tag} ${msg}${extra}`
}
