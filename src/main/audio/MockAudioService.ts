import type { AudioService } from './AudioService'
import type { AudioDevice, AudioSnapshot } from '@shared/types'

/**
 * In-memory fake backend used as a graceful fallback when svcl.exe is
 * unavailable. Mutations update local state so the UI feels real.
 */
export class MockAudioService implements AudioService {
  readonly isMock = true

  private playback: AudioDevice[] = [
    {
      id: 'mock-speakers',
      name: 'Speakers',
      description: 'Realtek High Definition Audio',
      direction: 'playback',
      icon: 'speaker',
      isDefault: true,
      volume: 64,
      muted: false
    },
    {
      id: 'mock-headphones',
      name: 'Headphones',
      description: 'Sony WH-1000XM5',
      direction: 'playback',
      icon: 'bluetooth',
      isDefault: false,
      volume: 80,
      muted: false,
      bluetooth: true
    },
    {
      id: 'mock-usb-dac',
      name: 'USB DAC',
      description: 'FiiO K7',
      direction: 'playback',
      icon: 'usb',
      isDefault: false,
      volume: 50,
      muted: false
    },
    {
      id: 'mock-hdmi',
      name: 'LG Monitor',
      description: 'HDMI Output',
      direction: 'playback',
      icon: 'hdmi',
      isDefault: false,
      volume: 100,
      muted: false
    }
  ]

  private recording: AudioDevice[] = [
    {
      id: 'mock-mic-array',
      name: 'Microphone Array',
      description: 'Realtek High Definition Audio',
      direction: 'recording',
      icon: 'mic',
      isDefault: true,
      volume: 75,
      muted: false
    },
    {
      id: 'mock-usb-mic',
      name: 'Blue Yeti',
      description: 'USB Microphone',
      direction: 'recording',
      icon: 'usb',
      isDefault: false,
      volume: 60,
      muted: false
    }
  ]

  async getSnapshot(): Promise<AudioSnapshot> {
    return {
      playback: this.playback.map((d) => ({ ...d })),
      recording: this.recording.map((d) => ({ ...d })),
      mock: true
    }
  }

  async setDefaultDevice(deviceId: string): Promise<void> {
    for (const list of [this.playback, this.recording]) {
      if (list.some((d) => d.id === deviceId)) {
        list.forEach((d) => (d.isDefault = d.id === deviceId))
      }
    }
  }

  async setDeviceVolume(deviceId: string, volume: number): Promise<void> {
    const d = this.findDevice(deviceId)
    if (d) d.volume = clamp(volume)
  }

  async setDeviceMuted(deviceId: string, muted: boolean): Promise<void> {
    const d = this.findDevice(deviceId)
    if (d) d.muted = muted
  }

  private findDevice(id: string): AudioDevice | undefined {
    return this.playback.find((d) => d.id === id) ?? this.recording.find((d) => d.id === id)
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}
