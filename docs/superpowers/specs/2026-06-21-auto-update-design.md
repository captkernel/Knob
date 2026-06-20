# SoundDeck Auto-Update — Design

Date: 2026-06-21
Status: Approved (pending spec review)

## Goal

Let shared SoundDeck builds update themselves with no manual user action, using
`electron-updater` against GitHub Releases.

## Update model (decided)

**NSIS installer + full background auto-update.**

- Ship an **NSIS installer** as the distributable "shareable" artifact.
- `electron-updater` checks GitHub Releases, downloads new versions in the background,
  and installs on app quit/restart (`autoInstallOnAppQuit`).
- The existing robocopy standalone folder (`release/SoundDeck/SoundDeck.exe`) stays
  exactly as-is as the local run/test build — it does **not** self-update.

## Activation dependency (important)

The GitHub provider fetches release metadata from a **public** repo without an embedded
token. `captkernel/sounddeck` is currently **private**.

Therefore:

- This code **ships now** but is a **no-op in production until** (a) the repo is flipped
  public (tracked separately as the "go public + signing" task) **and** (b) a tagged
  release is published to GitHub Releases.
- In **dev** (`!app.isPackaged`) the updater is fully disabled — `electron-updater`
  throws without an `app-update.yml`, so we never construct/start it there.

This ordering is intentional and correct: auto-update lands as part of this feature work
and activates at the end of the session when the repo goes public.

## UX decisions (decided)

- **Quiet toast.** Silent while checking and downloading. Only when the download finishes
  do we surface a small **"Update ready — Restart"** toast with a Restart button.
  `idle` / `checking` / `downloading` states render nothing in the panel.
- **Check timing.** Check once at startup (after `whenReady`, after the svcl ensure step),
  then on a **6-hour** repeating timer while the app runs.

## Components

### 1. Distribution config — `electron-builder.yml`

- Ensure an `nsis` target is present (confirm against current targets).
- Add a `publish` block:

  ```yaml
  publish:
    provider: github
    owner: captkernel
    repo: sounddeck
  ```

- `package.json` scripts: keep `dist` (`build && electron-builder`) as-is; add
  `dist:publish` → `electron-builder --publish always` for cutting a release.
- No change to `package:standalone` / `dist:standalone`.

### 2. New module — `src/main/updater.ts`

A thin wrapper around `electron-updater`'s `autoUpdater`.

Responsibilities:

- **Guard:** if `!app.isPackaged`, do nothing (no construction, no timer).
- Configure `autoDownload = true`, `autoInstallOnAppQuit = true`.
- Subscribe to `autoUpdater` events:
  `checking-for-update`, `update-available`, `update-not-available`,
  `download-progress`, `update-downloaded`, `error`.
- Map each event to an `UpdateStatus` via the **pure** `mapUpdaterEvent` function
  (see below) and broadcast it to the renderer over the `update:status` send channel.
- Start: run an initial `checkForUpdates()`, then `setInterval` every 6 hours.
- Expose a `quitAndInstall()` passthrough for the `update:install` IPC handler.
- Dependency-inject the `autoUpdater` instance and the broadcast function so the wrapper
  is testable without Electron (default args wire the real ones).

### 3. Pure mapper — `mapUpdaterEvent(event, data) → UpdateStatus`

Pure function, no Electron imports. The unit-testable core.

| Event                  | Resulting UpdateStatus                                  |
|------------------------|---------------------------------------------------------|
| `checking-for-update`  | `{ state: 'checking' }`                                 |
| `update-available`     | `{ state: 'downloading', version, percent: 0 }`         |
| `update-not-available` | `{ state: 'idle' }`                                      |
| `download-progress`    | `{ state: 'downloading', percent: Math.round(p.percent) }` |
| `update-downloaded`    | `{ state: 'ready', version }`                            |
| `error`                | `{ state: 'error', message }`                            |

(`downloading` is tracked internally even though the panel stays silent for it under the
"quiet toast" decision — keeping the state lets us flip on a progress UI later without
touching the mapper.)

### 4. IPC + types — `src/shared/types.ts`, `src/main/ipc.ts`, preload

- New send channel: `update:status` (main → renderer), payload `UpdateStatus`.
- New invoke channel: `update:install` (renderer → main) → `autoUpdater.quitAndInstall()`.
- `UpdateStatus` type:

  ```ts
  type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  interface UpdateStatus {
    state: UpdateState
    version?: string
    percent?: number
    message?: string
  }
  ```

- Extend the preload `api` with `onUpdateStatus(cb)` and `installUpdate()` following the
  existing send/invoke wrappers.

### 5. Renderer toast

- A small component subscribed to `update:status`.
- Renders **only** for `state === 'ready'`: "Update ready — Restart" + a button calling
  `api.installUpdate()`.
- All other states render nothing (quiet toast decision).
- Styling matches the existing glass panel.

### 6. Wiring — `src/main/index.ts`

After `whenReady` and the existing svcl `ensureSvcl` step, call
`startUpdater()` (the wrapper). Guarded internally by `app.isPackaged`.

## Error handling

- Updater `error` events become `{ state: 'error' }` and are logged via the existing file
  logger; the panel stays silent (no scary popups for a background tray app).
- Network failures / private-repo 404s surface only as logged errors — never block startup.
- The updater never throws into the main startup path (guarded + try/caught at the boundary).

## Testing

`test/updater.test.ts` (Vitest, pure-function style — matches existing convention):

- `mapUpdaterEvent` for each event type.
- `download-progress` percent rounding (e.g. 42.7 → 43).
- `error` message extraction.
- No Electron mocking required.

(The thin event-wiring in `updater.ts` is integration glue and out of scope for unit
tests, consistent with how the rest of the main process is tested.)

## Out of scope

- Code signing (separate task; unsigned NSIS still auto-updates but triggers SmartScreen
  on first install).
- Differential/delta updates beyond electron-updater defaults.
- Update channels (beta/stable) — single stable channel only.
