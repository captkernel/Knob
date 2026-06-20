import {
  Speaker,
  Headphones,
  Usb,
  MonitorSpeaker,
  Bluetooth,
  Mic,
  Volume2,
  type LucideIcon
} from 'lucide-react'
import type { DeviceIconKind } from '@shared/types'

const MAP: Record<DeviceIconKind, LucideIcon> = {
  speaker: Speaker,
  headphone: Headphones,
  usb: Usb,
  hdmi: MonitorSpeaker,
  bluetooth: Bluetooth,
  mic: Mic,
  unknown: Volume2
}

export function deviceIcon(kind: DeviceIconKind): LucideIcon {
  return MAP[kind] ?? Volume2
}
