import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AudioSnapshot,
  type HelperStatus,
  type HotkeyStatus,
  type Settings,
  type UpdateSettingsArgs,
  type UpdateStatus
} from '../shared/types'

/**
 * The ONLY surface the renderer can touch in the main process. Everything is
 * funneled through typed methods — no raw ipcRenderer, no node access.
 */
const api = {
  // ---- reads ----
  getSnapshot: (): Promise<AudioSnapshot> => ipcRenderer.invoke(IPC.getSnapshot),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  getHotkeyStatus: (): Promise<HotkeyStatus> => ipcRenderer.invoke(IPC.getHotkeyStatus),
  getHelperStatus: (): Promise<HelperStatus> => ipcRenderer.invoke(IPC.getHelperStatus),
  installHelper: (): Promise<HelperStatus> => ipcRenderer.invoke(IPC.installHelper),

  // ---- device actions ----
  setDefaultDevice: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.setDefaultDevice, deviceId),
  setDeviceVolume: (deviceId: string, volume: number): Promise<void> =>
    ipcRenderer.invoke(IPC.setDeviceVolume, deviceId, volume),
  setDeviceMuted: (deviceId: string, muted: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.setDeviceMuted, deviceId, muted),

  // ---- settings / window ----
  updateSettings: (patch: UpdateSettingsArgs['patch']): Promise<Settings> =>
    ipcRenderer.invoke(IPC.updateSettings, { patch }),
  hidePanel: (): Promise<void> => ipcRenderer.invoke(IPC.hidePanel),
  quit: (): Promise<void> => ipcRenderer.invoke(IPC.quit),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.installUpdate),

  // ---- main -> renderer events ----
  onSnapshotChanged: (cb: (snap: AudioSnapshot) => void): (() => void) =>
    subscribe(IPC.snapshotChanged, cb),
  onSettingsChanged: (cb: (settings: Settings) => void): (() => void) =>
    subscribe(IPC.settingsChanged, cb),
  onHotkeyStatusChanged: (cb: (status: HotkeyStatus) => void): (() => void) =>
    subscribe(IPC.hotkeyStatusChanged, cb),
  onHelperStatusChanged: (cb: (status: HelperStatus) => void): (() => void) =>
    subscribe(IPC.helperStatusChanged, cb),
  onPanelShown: (cb: () => void): (() => void) => subscribe(IPC.panelShown, cb),
  onNavigate: (cb: (view: string) => void): (() => void) => subscribe(IPC.navigate, cb),
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) =>
    subscribe(IPC.updateStatusChanged, cb)
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('sounddeck', api)

export type SoundDeckApi = typeof api
