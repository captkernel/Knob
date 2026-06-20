import { describe, it, expect } from 'vitest'
import { formatLogLine } from '../src/main/logFormat'

describe('formatLogLine', () => {
  const at = new Date('2026-06-20T10:30:00.000Z')

  it('renders an ISO timestamp, level and message', () => {
    expect(formatLogLine('info', 'hello', [], at)).toBe(
      '2026-06-20T10:30:00.000Z INFO  hello'
    )
  })

  it('pads the level so columns line up', () => {
    expect(formatLogLine('warn', 'x', [], at)).toBe('2026-06-20T10:30:00.000Z WARN  x')
    expect(formatLogLine('error', 'x', [], at)).toBe('2026-06-20T10:30:00.000Z ERROR x')
  })

  it('appends extra args, serializing objects as JSON', () => {
    expect(formatLogLine('info', 'msg', ['a', { n: 1 }], at)).toBe(
      '2026-06-20T10:30:00.000Z INFO  msg a {"n":1}'
    )
  })

  it('renders an Error as its message (not [object Object])', () => {
    const line = formatLogLine('error', 'boom', [new Error('nope')], at)
    expect(line).toContain('boom')
    expect(line).toContain('nope')
    expect(line).not.toContain('[object Object]')
  })

  it('survives a value that cannot be JSON-stringified', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => formatLogLine('info', 'm', [circular], at)).not.toThrow()
  })
})
