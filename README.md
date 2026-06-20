# SoundDeck

A polished Windows audio control panel that lives in the system tray and is summoned by a
global hotkey (**Ctrl + Alt + A** by default). One glance, one click: switch your default
speaker/mic, route individual apps to different outputs, and ride every volume slider —
then dismiss with the same hotkey, **Esc**, or a click outside.

![CI](https://github.com/captkernel/sounddeck/actions/workflows/ci.yml/badge.svg)
![version](https://img.shields.io/badge/version-1.0.0-blue)
![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6)
![license](https://img.shields.io/badge/license-MIT-green)

---

## Features

The focus is doing the core job rock-solid: **switch your default output/input device and control its volume**, fast, from a hotkey.

- **Output switcher** — every active playback device with friendly names + icons; click to set it as the system default. Selecting an output device also **clears stray per-app device overrides**, so every app follows your choice instead of staying pinned to an old device.
- **Input switcher** — same for microphones / recording devices.
- **Volume control** — a master slider (with mute) for the current default device.
- **Favorites** — star up to 3 devices for one-click access at the top.
- **Rename devices** — give any device a custom name (hover a device → pencil); stored per-device, survives reconnects.
- **Remember devices** — unplugged devices are remembered and shown dimmed as *Offline*; favorites/names re-bind by stable ID on replug.
- **Bluetooth-aware** — best-effort Bluetooth detection with a BT badge.
- **Polish** — frameless rounded glass panel, spring/fade animations (Framer Motion), dark theme, accent picker.
- **Tray + hotkey** — right-click tray menu (show / settings / quit), rebindable global hotkey, launch-on-startup.

> Per-app audio routing (sending individual apps to different devices) was intentionally left out — Windows applies it unreliably (only to an app's *next* stream) and it fought the master default switch. SoundDeck keeps the default-device switching predictable instead.

## Architecture

```
src/
  main/                 Electron main process
    index.ts            app lifecycle, single-instance, wiring
    window.ts           frameless/transparent panel, summon/dismiss, position memory
    tray.ts             tray icon + context menu
    hotkey.ts           global shortcut (rebindable, with safe fallback)
    ipc.ts              all renderer↔main audio/settings actions
    store.ts            JSON settings persistence (userData)
    audio/
      AudioService.ts   the swappable backend interface
      MockAudioService.ts   fake data (M1 + offline fallback)
      SvclAudioService.ts   real backend via NirSoft svcl.exe
      index.ts          picks the best available backend
  preload/index.ts      typed `window.sounddeck` IPC bridge (contextIsolation on)
  renderer/             React + Tailwind + Framer Motion UI
  shared/types.ts       single source of truth shared by all three layers
```

**Why a CLI helper?** Node/Electron can't do per-app audio routing or full device
enumeration natively. SoundDeck isolates every system call behind the `AudioService`
interface and drives [NirSoft **svcl.exe**](https://www.nirsoft.net/utils/sound_volume_command_line.html)
(the scriptable "SoundVolumeCommandLine" tool) as a child process. Swap in a native addon
later by writing one more `AudioService` implementation — nothing else changes.

## The svcl.exe dependency (read this)

NirSoft's license **forbids redistributing** its tools bundled inside another product, so
`svcl.exe` is **never committed and never bundled** in any build. Instead it's fetched
directly from nirsoft.net — so what's shared (source *or* binary) contains no NirSoft file:

- **Packaged app:** on **first run**, SoundDeck downloads `svcl.exe` into
  `%APPDATA%\sounddeck\helpers\` (the user installs the freeware themselves). It starts on
  **sample data** and **hot-swaps to your real devices** the moment the download finishes —
  no restart. An in-app banner shows progress and offers a **Retry** if you're offline.
- **From source (dev):** `npm install` runs `scripts/download-helpers.mjs`, which fetches
  `svcl.exe` into a **gitignored** `helpers/` folder for local runs.
- Either way, if it's unavailable the app still runs on sample data until it's installed.

svcl.exe is freeware © NirSoft. SoundDeck does not redistribute it.

## Build & run

Requires **Node 18+** (built on Node 24) on **Windows 10/11**.

```bash
npm install          # installs deps + fetches svcl.exe + generates icons
npm run dev          # launch in dev (HMR for the renderer)
```

Press **Ctrl + Alt + A** to summon the panel. It also lives in the system tray.

### Package

**Standalone app (recommended — no admin needed):**

```bash
npm run dist:standalone   # -> release/SoundDeck/SoundDeck.exe
```

This bundles the Electron runtime + the app into a self-contained, double-clickable
`release/SoundDeck/SoundDeck.exe` (svcl.exe is **not** bundled — it's downloaded on first
run, see above). Copy the `release/SoundDeck` folder anywhere and run it; zip it to share.

**Full NSIS installer / portable single-file `.exe`:**

```bash
npm run dist            # NSIS installer + portable .exe  -> release/
npm run dist:portable   # portable single .exe only
```

> ⚠️ `npm run dist*` (electron-builder) downloads `winCodeSign`, whose archive
> contains macOS symlinks that Windows refuses to extract unless **Developer Mode**
> (Settings → Privacy & security → For developers) or an **admin** shell is used.
> If you hit `A required privilege is not held by the client`, enable Developer Mode
> or just use `npm run dist:standalone`, which needs neither.

### Run on startup

Toggle **Launch on startup** in Settings (or it's set automatically). SoundDeck
registers itself under `HKCU\…\Run` and starts hidden in the tray on every login —
no terminal, no dev server. Quit any time from the tray menu.

## Settings

Gear icon (or tray → Settings): rebind the global hotkey (press a combo to capture),
launch-on-startup toggle, accent color, and per-device show/hide. The hotkey section
shows a **live status** — green when the shortcut is active, amber if it couldn't be
registered.

## Troubleshooting

**The hotkey doesn't open the panel.** A global shortcut can be claimed by only one
app at a time, so another program (a screenshot tool, an OEM audio utility, etc.) may
already own your combo — most often `Ctrl + Alt + A`. SoundDeck now handles this
gracefully:

- It **retries** registration for ~25s after launch (this wins the common race at
  login, where startup apps compete for the same combo).
- If it still can't bind, **Settings → Summon hotkey** shows an amber "unavailable"
  message and the tray tooltip says so too — just **pick a different combination**.
- You can **always open SoundDeck from the tray icon** (left-click, or right-click →
  *Show SoundDeck*) regardless of the hotkey.

**Where are the logs?** SoundDeck writes a rolling log to
`%APPDATA%\sounddeck\logs\main.log` (hotkey registration, audio-backend errors, and
any unexpected exceptions). Attach it to a bug report.

**It shows "Sample data" / sample devices.** The svcl.exe helper isn't installed yet. On a
packaged build it downloads automatically on first run — tap the banner to **Install/Retry**
if it didn't (e.g. you were offline). From source, run `npm install` to fetch it. See the
svcl.exe section above.

## Contributing

Issues and PRs welcome.

```bash
npm install      # deps + svcl.exe + icons
npm run check    # typecheck + tests + build (run this before opening a PR)
npm run dev      # live development
```

CI (GitHub Actions, `windows-latest`) runs typecheck + tests + build on every push and
PR. Keep the suite green and add tests for new pure logic (see `test/`).

## Roadmap

- [x] **M1** — scaffold: tray + global hotkey + summon/dismiss panel on mock data
- [x] **M2** — real device enumeration + set-default via svcl.exe; remember devices; Bluetooth
- [x] **M3** — device rename; standalone packaged app + launch-on-startup
- [x] **M4** — focused on the core: reliable output/input switching + volume (per-app routing removed)
- [x] **M5** — production hardening: resilient hotkey (retry + visible status), on-disk
  logging, global error handling, React error boundary, CI, tightened CSP
- [ ] **next** — real device hot-plug events (WM_DEVICECHANGE); Win11 acrylic glass

### Known limitations / not yet done

- **No code signing** — packaged builds are unsigned, so Windows SmartScreen shows a
  "Windows protected your PC" prompt on first run (*More info → Run anyway*). A signing
  certificate is needed to remove it.
- **No auto-update** — new versions are installed manually from Releases.
- **Binary redistribution & svcl.exe** — NirSoft's license forbids bundling `svcl.exe`
  inside a redistributed product. This repo never commits it (it's fetched per-install),
  so the **source repo is fine to share**. Before publishing binary releases that bundle
  it, switch to a download-on-first-run flow or a native backend.

## License

MIT (app code) — see [LICENSE](LICENSE). `svcl.exe` is NirSoft freeware and is **not**
redistributed here.
