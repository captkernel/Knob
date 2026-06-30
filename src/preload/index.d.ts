import type { KnobApi } from './index'

declare global {
  interface Window {
    knob: KnobApi
  }
}

export {}
