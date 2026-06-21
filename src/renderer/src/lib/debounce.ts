/**
 * Trailing-edge debounce: coalesces a burst of calls into a single invocation
 * `wait` ms after the last one. Used to collapse the multiple `devicechange`
 * events Chromium fires per physical plug/unplug into one device-list refresh.
 */
export interface Debounced {
  (): void
  /** Cancel any pending invocation (e.g. on unmount). */
  cancel: () => void
}

export function debounce(fn: () => void, wait: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined

  const debounced = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      fn()
    }, wait)
  }

  debounced.cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return debounced
}
