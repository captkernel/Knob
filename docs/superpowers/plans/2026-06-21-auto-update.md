# Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship full background auto-update for SoundDeck via `electron-updater` against GitHub Releases, surfaced as a quiet "Update ready — Restart" toast.

**Architecture:** A guarded main-process wrapper (`src/main/updater.ts`) drives `electron-updater`'s `autoUpdater`, maps its events through a pure `mapUpdaterEvent` function to an `UpdateStatus`, and broadcasts it over a new `update:status` IPC channel. The renderer shows a toast only on the `ready` state and calls a new `update:install` channel to restart-and-install. NSIS installer becomes the distributable; `electron-builder.yml` gains a GitHub `publish` block.

**Tech Stack:** Electron 33, electron-updater, electron-builder 25 (NSIS target already configured), React 18, Vitest 2, TypeScript 5.

## Global Constraints

- Updater is **only** active when `app.isPackaged` — never construct/start it in dev (`electron-updater` throws without `app-update.yml`).
- No handler may throw past the IPC boundary or the main startup path (follow the existing try/catch + `log.error` convention from `src/main/ipc.ts`).
- All logging goes through `import { log } from './logger'`.
- IPC channel names live ONLY in the `IPC` object in `src/shared/types.ts` (single source of truth).
- The renderer touches main ONLY through the preload `api` (`window.sounddeck`) — no raw `ipcRenderer`.
- Quiet-toast UX: the panel renders update UI **only** for `state === 'ready'`. `idle`/`checking`/`downloading`/`error` render nothing.
- Tests are pure-function Vitest in `test/*.test.ts` — no Electron mocking.
- The robocopy standalone build (`scripts/package-standalone.ps1`) is unchanged and does NOT self-update.

---

### Task 1: Types & IPC channels

**Files:**
- Modify: `src/shared/types.ts` (add `UpdateState`/`UpdateStatus` types near the other status types ~line 83; add two channels to the `IPC` object ~lines 114-134)

**Interfaces:**
- Produces:
  - `type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'`
  - `interface UpdateStatus { state: UpdateState; version?: string; percent?: number; message?: string }`
  - `IPC.installUpdate = 'update:install'` (invoke), `IPC.updateStatus = 'update:status'` (send)

- [ ] **Step 1: Add the types.** In `src/shared/types.ts`, after the `HotkeyStatus` interface (line 83), add:

```ts
/** Background auto-update state, surfaced to the panel as a quiet toast. */
export type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** Target version, when known (available/ready). */
  version?: string
  /** Download progress 0..100, when downloading. */
  percent?: number
  /** Error detail, when state === 'error'. */
  message?: string
}
```

- [ ] **Step 2: Add the IPC channels.** In the `IPC` object, add to the invoke group (after `installHelper:`):

```ts
  installUpdate: 'update:install',
```

and to the send group (after `helperStatusChanged:`):

```ts
  updateStatusChanged: 'update:status',
```

- [ ] **Step 3: Verify it compiles.**

Run: `npm run typecheck`
Expected: PASS (no usages yet, just new exports).

- [ ] **Step 4: Commit.**

```bash
git add src/shared/types.ts
git commit -m "feat(update): add UpdateStatus type and update IPC channels"
```

---

### Task 2: Pure event mapper (`mapUpdaterEvent`)

**Files:**
- Create: `src/main/updaterMap.ts`
- Test: `test/updater.test.ts`

**Interfaces:**
- Consumes: `UpdateStatus` from `@shared/types`.
- Produces: `mapUpdaterEvent(event: UpdaterEventName, data?: UpdaterEventData): UpdateStatus`
  - `type UpdaterEventName = 'checking-for-update' | 'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error'`
  - `interface UpdaterEventData { version?: string; percent?: number; message?: string }`

This is the unit-testable core. Pure — NO `electron`/`electron-updater` imports.

- [ ] **Step 1: Write the failing test.** Create `test/updater.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapUpdaterEvent } from '../src/main/updaterMap'

describe('mapUpdaterEvent', () => {
  it('checking-for-update -> checking', () => {
    expect(mapUpdaterEvent('checking-for-update')).toEqual({ state: 'checking' })
  })

  it('update-available -> downloading at 0% with version', () => {
    expect(mapUpdaterEvent('update-available', { version: '1.2.0' })).toEqual({
      state: 'downloading',
      version: '1.2.0',
      percent: 0
    })
  })

  it('update-not-available -> idle', () => {
    expect(mapUpdaterEvent('update-not-available')).toEqual({ state: 'idle' })
  })

  it('download-progress -> downloading with rounded percent', () => {
    expect(mapUpdaterEvent('download-progress', { percent: 42.7 })).toEqual({
      state: 'downloading',
      percent: 43
    })
  })

  it('download-progress with missing percent defaults to 0', () => {
    expect(mapUpdaterEvent('download-progress', {})).toEqual({ state: 'downloading', percent: 0 })
  })

  it('update-downloaded -> ready with version', () => {
    expect(mapUpdaterEvent('update-downloaded', { version: '1.2.0' })).toEqual({
      state: 'ready',
      version: '1.2.0'
    })
  })

  it('error -> error with message', () => {
    expect(mapUpdaterEvent('error', { message: 'boom' })).toEqual({
      state: 'error',
      message: 'boom'
    })
  })

  it('error with no message still returns error state', () => {
    expect(mapUpdaterEvent('error')).toEqual({ state: 'error', message: 'Unknown update error' })
  })
})
```

- [ ] **Step 2: Run it — verify it fails.**

Run: `npm run test -- updater`
Expected: FAIL — "Cannot find module '../src/main/updaterMap'".

- [ ] **Step 3: Implement the mapper.** Create `src/main/updaterMap.ts`:

```ts
import type { UpdateStatus } from '@shared/types'

export type UpdaterEventName =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error'

export interface UpdaterEventData {
  version?: string
  percent?: number
  message?: string
}

/**
 * Pure mapping from an electron-updater event to the renderer-facing UpdateStatus.
 * No Electron imports so it is unit-testable in isolation.
 */
export function mapUpdaterEvent(event: UpdaterEventName, data: UpdaterEventData = {}): UpdateStatus {
  switch (event) {
    case 'checking-for-update':
      return { state: 'checking' }
    case 'update-available':
      return { state: 'downloading', version: data.version, percent: 0 }
    case 'update-not-available':
      return { state: 'idle' }
    case 'download-progress':
      return { state: 'downloading', percent: Math.round(data.percent ?? 0) }
    case 'update-downloaded':
      return { state: 'ready', version: data.version }
    case 'error':
      return { state: 'error', message: data.message ?? 'Unknown update error' }
  }
}
```

- [ ] **Step 4: Run the test — verify it passes.**

Run: `npm run test -- updater`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/main/updaterMap.ts test/updater.test.ts
git commit -m "feat(update): pure mapUpdaterEvent with tests"
```

---

### Task 3: Add electron-updater dependency

**Files:**
- Modify: `package.json` (dependencies + scripts)

**Interfaces:**
- Produces: `electron-updater` importable in main; `autoUpdater` export available.

- [ ] **Step 1: Install electron-updater as a runtime dependency.**

Run: `npm install electron-updater@^6.3.9 --save`
Expected: adds `electron-updater` to `dependencies` in `package.json`; no audit errors that block install.

(Rationale: `electron-updater` ships in the app bundle, so it is a runtime `dependency`, not devDependency. Version 6.x targets electron-builder 25.)

- [ ] **Step 2: Add a publish script.** In `package.json` `scripts`, after `"dist:portable"`, add:

```json
    "dist:publish": "npm run build && electron-builder --publish always",
```

- [ ] **Step 3: Verify install + typecheck.**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add package.json package-lock.json
git commit -m "build(update): add electron-updater dependency and dist:publish script"
```

---

### Task 4: electron-builder publish config

**Files:**
- Modify: `electron-builder.yml` (add `publish` block)

**Interfaces:**
- Produces: GitHub publish provider so `electron-builder --publish` uploads releases and the packaged app embeds `app-update.yml` pointing at `captkernel/sounddeck`.

- [ ] **Step 1: Add the publish block.** In `electron-builder.yml`, after the `extraResources:` block (before `win:`), add:

```yaml
# Auto-update feed. electron-updater reads release metadata from GitHub Releases.
# Works only against a PUBLIC repo without an embedded token, and only once a
# tagged release is published. No-op in dev and on the standalone folder build.
publish:
  provider: github
  owner: captkernel
  repo: sounddeck
```

- [ ] **Step 2: Verify the build still configures.**

Run: `npm run build`
Expected: PASS (electron-vite build completes; publish config is only consumed by `electron-builder`, not the build).

- [ ] **Step 3: Commit.**

```bash
git add electron-builder.yml
git commit -m "build(update): add GitHub publish provider for auto-update feed"
```

---

### Task 5: Updater wrapper (`startUpdater`)

**Files:**
- Create: `src/main/updater.ts`

**Interfaces:**
- Consumes: `mapUpdaterEvent`, `UpdaterEventName`, `UpdaterEventData` from `./updaterMap`; `IPC`, `UpdateStatus` from `@shared/types`; `log` from `./logger`; `getWindow` from `./window`; `app`, `autoUpdater`.
- Produces:
  - `startUpdater(): void` — guarded by `app.isPackaged`; wires events, runs an initial check, schedules a 6h timer.
  - `installUpdate(): void` — passthrough to `autoUpdater.quitAndInstall()`.

- [ ] **Step 1: Implement the wrapper.** Create `src/main/updater.ts`:

```ts
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC, type UpdateStatus } from '@shared/types'
import { mapUpdaterEvent, type UpdaterEventName, type UpdaterEventData } from './updaterMap'
import { getWindow } from './window'
import { log } from './logger'

const SIX_HOURS_MS = 6 * 60 * 60 * 1000

function broadcast(status: UpdateStatus): void {
  getWindow()?.webContents.send(IPC.updateStatusChanged, status)
}

function emit(event: UpdaterEventName, data?: UpdaterEventData): void {
  try {
    broadcast(mapUpdaterEvent(event, data))
  } catch (err) {
    log.error('[updater] broadcast failed:', err)
  }
}

function check(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    // Private-repo 404s / offline land here. Log only — never block, never popup.
    log.error('[updater] checkForUpdates failed:', err)
    emit('error', { message: String((err as Error)?.message ?? err) })
  })
}

/**
 * Wire electron-updater and begin checking. No-op unless packaged (electron-updater
 * throws without app-update.yml in dev). Never throws into the startup path.
 */
export function startUpdater(): void {
  if (!app.isPackaged) {
    log.info('[updater] skipped (not packaged)')
    return
  }
  try {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null // we route through our own logger via events

    autoUpdater.on('checking-for-update', () => emit('checking-for-update'))
    autoUpdater.on('update-available', (info) => emit('update-available', { version: info.version }))
    autoUpdater.on('update-not-available', () => emit('update-not-available'))
    autoUpdater.on('download-progress', (p) => emit('download-progress', { percent: p.percent }))
    autoUpdater.on('update-downloaded', (info) => emit('update-downloaded', { version: info.version }))
    autoUpdater.on('error', (err) => emit('error', { message: String(err?.message ?? err) }))

    check()
    setInterval(check, SIX_HOURS_MS)
    log.info('[updater] started')
  } catch (err) {
    log.error('[updater] start failed:', err)
  }
}

/** Restart and install a downloaded update. */
export function installUpdate(): void {
  try {
    autoUpdater.quitAndInstall()
  } catch (err) {
    log.error('[updater] quitAndInstall failed:', err)
  }
}
```

- [ ] **Step 2: Verify it compiles.**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/main/updater.ts
git commit -m "feat(update): electron-updater wrapper (guarded, 6h checks)"
```

---

### Task 6: Wire updater into main + install IPC handler

**Files:**
- Modify: `src/main/index.ts` (import + call `startUpdater()` after `ensureSvcl`)
- Modify: `src/main/ipc.ts` (handle `IPC.installUpdate`)

**Interfaces:**
- Consumes: `startUpdater`, `installUpdate` from `./updater`.

- [ ] **Step 1: Import and start the updater.** In `src/main/index.ts`, add to imports (after the `ensureSvcl` import, line 8):

```ts
import { startUpdater } from './updater'
```

Then after the `void ensureSvcl().then(...)` block (line 46), add:

```ts
    // Background auto-update (packaged + public repo + published release only).
    startUpdater()
```

- [ ] **Step 2: Handle the install channel.** In `src/main/ipc.ts`, add the import (after line 7):

```ts
import { installUpdate } from './updater'
```

Then inside `registerIpc`, after the `IPC.quit` handler (line 137), add:

```ts
  ipcMain.handle(IPC.installUpdate, () => {
    installUpdate()
  })
```

- [ ] **Step 3: Verify it compiles.**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/main/index.ts src/main/ipc.ts
git commit -m "feat(update): start updater on launch and wire install IPC"
```

---

### Task 7: Preload bridge

**Files:**
- Modify: `src/preload/index.ts` (add `installUpdate` + `onUpdateStatus` to `api`)

**Interfaces:**
- Consumes: `IPC`, `UpdateStatus` from `../shared/types`.
- Produces (on `window.sounddeck`):
  - `installUpdate(): Promise<void>`
  - `onUpdateStatus(cb: (status: UpdateStatus) => void): () => void`

- [ ] **Step 1: Import the type.** In `src/preload/index.ts`, add `type UpdateStatus` to the existing `@shared/types`-equivalent import block (lines 2-9):

```ts
  type UpdateSettingsArgs,
  type UpdateStatus
```

- [ ] **Step 2: Add the invoke method.** In the `// ---- settings / window ----` group (after `quit:`, line 35), add:

```ts
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.installUpdate),
```

- [ ] **Step 3: Add the subscription.** In the `// ---- main -> renderer events ----` group (after `onNavigate`, line 47), add a comma to the prior line then:

```ts
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) =>
    subscribe(IPC.updateStatusChanged, cb)
```

- [ ] **Step 4: Verify it compiles.**

Run: `npm run typecheck`
Expected: PASS. (`SoundDeckApi = typeof api` auto-propagates the new methods to the renderer global.)

- [ ] **Step 5: Commit.**

```bash
git add src/preload/index.ts
git commit -m "feat(update): expose installUpdate and onUpdateStatus on preload api"
```

---

### Task 8: Renderer update toast

**Files:**
- Create: `src/renderer/src/components/UpdateToast.tsx`
- Modify: `src/renderer/src/App.tsx` (subscribe to status, render the toast)

**Interfaces:**
- Consumes: `api.onUpdateStatus`, `api.installUpdate` from `./lib/api`; `UpdateStatus` from `@shared/types`.

- [ ] **Step 1: Create the toast component.** Create `src/renderer/src/components/UpdateToast.tsx`:

```tsx
import { motion } from 'framer-motion'
import { Download } from 'lucide-react'

/**
 * Quiet update toast: rendered ONLY when an update has finished downloading and
 * is ready to install. Checking/downloading/error states render nothing.
 */
export function UpdateToast({
  version,
  onRestart
}: {
  version?: string
  onRestart: () => void
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="no-drag absolute bottom-3 left-3 right-3 z-20 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-3 py-2 text-xs text-white shadow-panel backdrop-blur-xl"
    >
      <Download size={14} className="shrink-0" />
      <span className="flex-1">
        Update{version ? ` ${version}` : ''} ready to install.
      </span>
      <button
        onClick={onRestart}
        className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 font-medium transition-colors hover:bg-white/20"
      >
        Restart
      </button>
    </motion.div>
  )
}
```

- [ ] **Step 2: Subscribe to update status in App.** In `src/renderer/src/App.tsx`, add the import (after the `SettingsView` import, line 9):

```tsx
import { UpdateToast } from './components/UpdateToast'
```

Add `UpdateStatus` to the `@shared/types` type import (line 4):

```tsx
import type { AudioDevice, AudioSnapshot, HelperStatus, HotkeyStatus, Settings, UpdateStatus } from '@shared/types'
```

Add state next to the other `useState` calls (after line 22):

```tsx
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
```

Inside the bootstrap `useEffect` (lines 60-88), add a subscription alongside the others — after `const offNav = ...` (line 79):

```tsx
    const offUpdate = api.onUpdateStatus(setUpdate)
```

and add `offUpdate()` to the cleanup return (after `offNav()`, line 85).

- [ ] **Step 3: Render the toast.** In `src/renderer/src/App.tsx`, inside the outer panel `motion.div` (after the accent-glow `div`, line 189, before `<AnimatePresence mode="wait">`), add:

```tsx
        <AnimatePresence>
          {update?.state === 'ready' && (
            <UpdateToast
              version={update.version}
              onRestart={() => api.installUpdate().catch(logErr)}
            />
          )}
        </AnimatePresence>
```

(`AnimatePresence` and `motion` are already imported in App.tsx.)

- [ ] **Step 4: Verify typecheck + build.**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/renderer/src/components/UpdateToast.tsx src/renderer/src/App.tsx
git commit -m "feat(update): quiet update-ready toast in panel"
```

---

### Task 9: Full verification + build the run artifact

**Files:** none (verification only)

- [ ] **Step 1: Run the full check.**

Run: `npm run check`
Expected: PASS — typecheck, all tests (now 67: 59 prior + 8 new), and build all green.

- [ ] **Step 2: Rebuild the standalone run artifact** (per the workspace convention to always have `release/SoundDeck/SoundDeck.exe` current after changes).

Run: `npm run dist:standalone`
Expected: PASS; `release/SoundDeck/SoundDeck.exe` exists; the redistribution guard confirms svcl.exe is NOT bundled.

- [ ] **Step 3: Sanity-check the updater is dormant in this build.** Launch is optional (only when asked). The updater no-ops because the standalone folder build still reports `app.isPackaged` — BUT confirm by reading the log path note: in the standalone build the updater may attempt a check against the (still private) repo and log a 404 to the file logger. That is expected and harmless; it never surfaces UI. (No code change — just awareness for the public-repo activation step.)

- [ ] **Step 4: Final commit (if any artifacts/log tweaks).**

```bash
git status
# commit only if there are tracked changes from the steps above
```

---

## Activation checklist (deferred to the "go public" task — NOT part of this plan's coding)

These steps turn the feature live; they belong to the final session task:

1. `gh repo edit captkernel/sounddeck --visibility public`
2. Bump `version` in `package.json`, then `npm run dist:publish` to build the NSIS installer and upload it + `latest.yml` to a GitHub Release.
3. Installed clients then auto-detect, download, and prompt "Update ready — Restart".

## Self-Review notes

- **Spec coverage:** distribution config (Tasks 3-4), updater module + pure mapper (Tasks 2,5), IPC/types (Tasks 1,6,7), renderer toast (Task 8), tests (Task 2), activation dependency (documented, deferred). All spec sections mapped.
- **Type consistency:** `UpdateStatus`/`UpdateState` defined once (Task 1) and consumed by name everywhere; channel constants `IPC.installUpdate` / `IPC.updateStatusChanged` used consistently across main, preload, renderer.
- **No placeholders:** every code step shows complete code.
