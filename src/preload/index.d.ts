import type { SoundDeckApi } from './index'

declare global {
  interface Window {
    sounddeck: SoundDeckApi
  }
}

export {}
