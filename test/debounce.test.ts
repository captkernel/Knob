import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from '../src/renderer/src/lib/debounce'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('invokes once after the wait, not per call', () => {
    const fn = vi.fn()
    const d = debounce(fn, 400)
    d()
    d()
    d()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(399)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a later call resets the timer (trailing edge)', () => {
    const fn = vi.fn()
    const d = debounce(fn, 400)
    d()
    vi.advanceTimersByTime(300)
    d() // resets the 400ms window
    vi.advanceTimersByTime(300)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel() prevents a pending invocation', () => {
    const fn = vi.fn()
    const d = debounce(fn, 400)
    d()
    d.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('can fire again after a completed cycle', () => {
    const fn = vi.fn()
    const d = debounce(fn, 200)
    d()
    vi.advanceTimersByTime(200)
    d()
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
