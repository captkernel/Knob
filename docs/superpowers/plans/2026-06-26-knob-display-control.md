# Knob Display Control — Implementation Plan (Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Display** tab to the panel that shows the live monitor layout (to scale, with resolution + refresh) and lets the user save/apply named display profiles (which monitors are on, where they sit, which is primary) — mirroring SoundDeck's audio-profile UX and helper model.

**Architecture:** A second NirSoft CLI helper (`MultiMonitorTool.exe`), downloaded **lazily** the first time the Display tab opens, drives a new `DisplayService` (real + mock) behind a swappable wrapper — exactly like the existing svcl audio stack. Pure, header-tolerant parsing and a pure apply-planner make the core logic unit-testable; the renderer gets an `Audio | Display` tab shell and a read-only layout diagram designed so Phase B can make it interactive with zero rework.

**Tech Stack:** Electron 33 (main/preload/renderer), TypeScript (ESM main), React 18 + framer-motion + Tailwind, Vitest. No new npm dependencies.

## Global Constraints

- **No bundling of MultiMonitorTool** — NirSoft license forbids it. Download on first use from `https://www.nirsoft.net/utils/multimonitortool-x64.zip` over HTTPS, extract with PowerShell `Expand-Archive`, cache under `userData/helpers` — identical mechanics to `svclInstaller.ts`. (Verify the exact zip URL in Task 1.)
- **Lazy provisioning** — MultiMonitorTool is NOT fetched at app startup. It is fetched only when the renderer first opens the Display tab (and via the in-banner Retry). The svcl startup path stays untouched.
- **Topology only on apply** — apply enable/disable, position, and primary. **Never force resolution/refresh.** `width`/`height`/`refreshHz` are captured and displayed but not written, so survivors renegotiate their best mode when a monitor is disabled.
- **Never throw past the IPC boundary** — every main handler catches and degrades, matching `ipc.ts`. Reads degrade to last-known snapshot; writes return a structured `ApplyResult` with an `error` string rather than rejecting.
- **Validate before applying** — at least one connected monitor must stay enabled and exactly one must be primary; refuse all-off profiles with no partial-destructive state.
- **ESM/CJS gotcha** — main is ESM (`"type": "module"`). Use `node:`-prefixed core imports (as existing files do). No CommonJS default-import traps here (no new deps).
- **Stable monitor identity** — a monitor's `id` is its serial number if present, else Monitor ID, else the `\\.\DISPLAYn` name. This id must be a value MultiMonitorTool also accepts as a command target (verify in Task 1).
- **Settings caps & coercion** — `displayProfiles` is validated by `coerceSettings` with the same rigor as audio `profiles`, capped at `DISPLAY_PROFILES_MAX = 24`.

---

## File Structure

**Created:**
- `src/main/mmtInstaller.ts` — MultiMonitorTool provisioning (parallels `svclInstaller.ts`), lazy `ensureMmt()`.
- `src/main/display/DisplayService.ts` — `DisplayService` interface.
- `src/main/display/MmtDisplayService.ts` — real backend (shells out to MultiMonitorTool).
- `src/main/display/MockDisplayService.ts` — fake 2-monitor backend for non-Windows/dev.
- `src/main/display/mmtParse.ts` — pure CSV → `MonitorState[]`.
- `src/main/display/displayPlan.ts` — pure `validateArrangement` + `planApply` (target → MMT command argv list).
- `src/main/display/index.ts` — `SwappableDisplayService`, `createDisplayService`, `swapToMmtIfMock`.
- `src/renderer/src/components/DisplayView.tsx` — Display tab body (helper banner + diagram + profiles).
- `src/renderer/src/components/LayoutDiagram.tsx` — read-only to-scale monitor diagram.
- `src/renderer/src/components/DisplayProfilesRow.tsx` — display-profile chips + "Save current" composer.
- `test/mmtParse.test.ts`, `test/displayPlan.test.ts` — unit tests.

**Modified:**
- `src/shared/types.ts` — new types, `Settings.displayProfiles`, `DEFAULT_SETTINGS`, IPC channels.
- `src/main/settingsSchema.ts` — coerce `displayProfiles`.
- `src/main/ipc.ts` — register `display:*` handlers; accept a `DisplayService`.
- `src/main/index.ts` — build the display service, wire helper-status streaming, pass to `registerIpc`.
- `src/preload/index.ts` — display methods + events on the bridge.
- `src/renderer/src/App.tsx` — `Audio | Display` tab shell; mount `DisplayView`.
- `test/settingsSchema.test.ts` — `displayProfiles` coercion cases.

---

## Task 1: Verify the MultiMonitorTool CLI (empirical spike)

This is a **non-code investigation** task that pins the exact flags, column names, and command target syntax the later tasks depend on. Everything testable downstream is header-tolerant, but the thin service and fixtures must match reality.

**Files:** none (notes captured in the PR description / commit message).

- [ ] **Step 1: Get the tool**

Download `multimonitortool-x64.zip` from nirsoft.net and extract `MultiMonitorTool.exe` to a scratch dir. Confirm the exact zip URL (the installer in Task 2 must use it verbatim).

- [ ] **Step 2: Capture an enumeration sample**

Run, in a scratch dir:
```
MultiMonitorTool.exe /scomma monitors.csv
```
Open `monitors.csv`. Record the **exact header names** for: friendly monitor name, serial number, monitor id, active/enabled flag, primary flag, resolution (or width/height), position (left-top), and refresh frequency. These pin the fixtures in Tasks 6–7.

> If `/scomma ""` streams to stdout (as svcl does) use that; otherwise the service writes to a temp file and reads it (Task 9 handles both — default to the temp-file path, which is guaranteed).

- [ ] **Step 3: Confirm command target + apply syntax**

Verify which identifier `/enable`, `/disable`, `/SetPrimary`, and `/SetMonitors` accept (serial number vs `\\.\DISPLAYn` vs index) and the `/SetMonitors` field syntax (e.g. `Name=<id> PositionX=<n> PositionY=<n> SetAsPrimary=1`). On a multi-monitor box, manually test disable + reposition + set-primary and confirm it works and is reversible from Windows Settings.

- [ ] **Step 4: Record findings**

Write the confirmed URL, header names, and command syntax into the PR description so Tasks 2, 6, 7, and 9 use exact values. No commit (no files changed).

---

## Task 1 Findings — confirmed on real hardware (2026-06-26)

Ran the lazy-download path and `/scomma` on the actual 3-monitor machine. These pin Tasks 2–9 (the plan below is already updated to match):

- **Zip URL confirmed:** `https://www.nirsoft.net/utils/multimonitortool-x64.zip` (download + `Expand-Archive` worked).
- **`/scomma <file>` writes a CSV file** — use the temp-file path; do not rely on stdout streaming.
- **Real header (22 columns):**
  `Resolution,Left-Top,Right-Bottom,Active,Disconnected,Primary,Colors,Frequency,Orientation,Maximum Resolution,Current Scale,Maximum Scale,Name,Adapter,Device ID,Device Key,Monitor ID,Short Monitor ID,Monitor Key,Monitor String,Monitor Name,Monitor Serial Number`
- **Identity (critical):** `Monitor Serial Number` is EMPTY on all monitors, and `\\.\DISPLAYn` (`Name`) is NOT stable across enable/disable/replug. Therefore:
  - **Stable match key `id` = `Short Monitor ID`** (e.g. `GSM772A`, `AOC1970`, `SDC420A`), fallback `Monitor ID`, fallback `Name`.
  - **Command target `device` = `Name`** (`\\.\DISPLAY1`), resolved fresh at apply time from the live snapshot — NEVER from the stored profile. New `MonitorState.device` field carries this.
- **Friendly name heuristic:** prefer `Monitor String` unless it is empty or `Generic PnP Monitor`, then `Monitor Name`; fallback `Short Monitor ID`. (Yields "AOC 1970W", "LG QHD", "Lenovo DisplayHDR" on this rig.)
- **Geometry:** `Resolution` = "2560 X 1440"; `Left-Top` = "0, 0"; `Frequency` integer (0 when disabled → `refreshHz` undefined).
- **Flags:** `Active` Yes/No → `enabled`; `Primary` Yes/No → `primary`; rows with `Disconnected = Yes` are excluded (not physically present).
- **Apply syntax NOT auto-verified** (it mutates the live display). The planner emits `/enable <device>`, `/SetMonitors "Name=<device> PositionX=.. PositionY=.. [SetAsPrimary=1]"` (topology only — width/height/frequency omitted so a disabled monitor's freed bandwidth lets survivors renegotiate), `/disable <device>` last. Exact flag acceptance is confirmed in the Task 16 manual smoke with the user present (a wrong command is instantly recoverable from Windows Settings).

---

## Task 2: Shared types, settings field, and IPC channels

**Files:**
- Modify: `src/shared/types.ts`
- Test: (covered by Task 3)

**Interfaces:**
- Produces: `MonitorState`, `DisplaySnapshot`, `DisplayProfile`, `ApplyResult`; `Settings.displayProfiles: DisplayProfile[]`; `DISPLAY_PROFILES_MAX`; new `IPC` keys `getDisplaySnapshot`, `applyDisplay`, `ensureDisplayHelper`, `getDisplayHelperStatus`, `displaySnapshotChanged`, `displayHelperStatusChanged`.

- [ ] **Step 1: Add the display types**

In `src/shared/types.ts`, after the `Profile` interface, add:
```ts
/** One monitor's state, captured from / applied to the OS. */
export interface MonitorState {
  /** Stable match key: Short Monitor ID, else Monitor ID, else \\.\DISPLAYn name. */
  id: string
  /** Current OS handle (\\.\DISPLAYn) used as the apply command target. Volatile —
   *  re-resolved from a live snapshot at apply time, never trusted from a profile. */
  device: string
  name: string // friendly name, e.g. "LG QHD"
  enabled: boolean
  primary: boolean
  x: number
  y: number
  width: number
  height: number
  refreshHz?: number
}

export interface DisplaySnapshot {
  monitors: MonitorState[]
  /** True when running on mock data (MultiMonitorTool unavailable). */
  mock: boolean
}

/** A saved monitor arrangement the user can apply in one tap. */
export interface DisplayProfile {
  id: string // crypto.randomUUID()
  name: string
  monitors: MonitorState[]
}

/** Result of applying an arrangement, so the UI can surface partial applies. */
export interface ApplyResult {
  ok: boolean
  appliedCount: number
  /** ids present in the profile but not currently connected. */
  missingIds: string[]
  error?: string
}
```

- [ ] **Step 2: Add the settings field + default**

In the `Settings` interface add `displayProfiles: DisplayProfile[]` (next to `profiles`), and in `DEFAULT_SETTINGS` add `displayProfiles: []`.

- [ ] **Step 3: Add IPC channel names**

In the `IPC` object, under the renderer→main group add:
```ts
  getDisplaySnapshot: 'display:getSnapshot',
  applyDisplay: 'display:apply',
  ensureDisplayHelper: 'display:ensureHelper',
  getDisplayHelperStatus: 'display:getHelperStatus',
```
and under the main→renderer group add:
```ts
  displaySnapshotChanged: 'display:snapshotChanged',
  displayHelperStatusChanged: 'display:helperStatusChanged',
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (types compile; nothing consumes them yet).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(display): shared types, settings field, IPC channels"
```

---

## Task 3: Coerce `displayProfiles` in settings

**Files:**
- Modify: `src/main/settingsSchema.ts`
- Test: `test/settingsSchema.test.ts`

**Interfaces:**
- Consumes: `MonitorState`, `DisplayProfile`, `DISPLAY_PROFILES_MAX` from Task 2.
- Produces: validated `Settings.displayProfiles` out of `coerceSettings`.

- [ ] **Step 1: Write the failing tests**

Add to `test/settingsSchema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { coerceSettings } from '../src/main/settingsSchema'

describe('coerceSettings displayProfiles', () => {
  const monitor = {
    id: 'GSM772A', device: '\\\\.\\DISPLAY1', name: 'LG QHD', enabled: true, primary: true,
    x: 0, y: 0, width: 2560, height: 1440, refreshHz: 144
  }
  it('keeps a well-formed display profile', () => {
    const out = coerceSettings({ displayProfiles: [{ id: 'p1', name: 'Work', monitors: [monitor] }] })
    expect(out.displayProfiles).toHaveLength(1)
    expect(out.displayProfiles[0].monitors[0].width).toBe(2560)
  })
  it('drops profiles with no valid monitors', () => {
    const out = coerceSettings({ displayProfiles: [{ id: 'p1', name: 'X', monitors: [{ id: '' }] }] })
    expect(out.displayProfiles).toHaveLength(0)
  })
  it('defaults to [] when absent or wrong-typed', () => {
    expect(coerceSettings({}).displayProfiles).toEqual([])
    expect(coerceSettings({ displayProfiles: 'nope' }).displayProfiles).toEqual([])
  })
  it('caps the list length', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: 'n', monitors: [monitor] }))
    expect(coerceSettings({ displayProfiles: many }).displayProfiles.length).toBeLessThanOrEqual(24)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/settingsSchema.test.ts`
Expected: FAIL (`displayProfiles` is undefined).

- [ ] **Step 3: Implement coercion**

In `src/main/settingsSchema.ts`:
- Import `MonitorState`, `DisplayProfile` from `@shared/types`.
- Add `const DISPLAY_PROFILES_MAX = 24`.
- Add helpers:
```ts
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function monitorState(v: unknown): MonitorState | null {
  if (!isObj(v) || typeof v.id !== 'string' || v.id === '') return null
  return {
    id: v.id,
    device: typeof v.device === 'string' ? v.device : '',
    name: typeof v.name === 'string' ? v.name : v.id,
    enabled: bool(v.enabled, true),
    primary: bool(v.primary, false),
    x: num(v.x), y: num(v.y),
    width: num(v.width), height: num(v.height),
    ...(typeof v.refreshHz === 'number' && Number.isFinite(v.refreshHz) ? { refreshHz: v.refreshHz } : {})
  }
}

function displayProfiles(v: unknown): DisplayProfile[] {
  if (!Array.isArray(v)) return []
  const out: DisplayProfile[] = []
  for (const p of v) {
    if (!isObj(p) || typeof p.id !== 'string' || p.id === '') continue
    const monitors = Array.isArray(p.monitors)
      ? p.monitors.map(monitorState).filter((m): m is MonitorState => m !== null)
      : []
    if (monitors.length === 0) continue
    const name = cleanAlias(typeof p.name === 'string' ? p.name : '')
    out.push({ id: p.id, name: name || 'Profile', monitors })
    if (out.length >= DISPLAY_PROFILES_MAX) break
  }
  return out
}
```
- In the returned object of `coerceSettings`, add `displayProfiles: displayProfiles(o.displayProfiles)`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/settingsSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/settingsSchema.ts test/settingsSchema.test.ts
git commit -m "feat(display): coerce and cap displayProfiles in settings"
```

---

## Task 4: MultiMonitorTool installer (lazy provisioning)

**Files:**
- Create: `src/main/mmtInstaller.ts`

**Interfaces:**
- Produces: `getMmtStatus(): HelperStatus`, `onMmtStatus(cb)`, `resolveMmtPath(): string | null`, `ensureMmt(): Promise<string | null>`, `installMmt(): Promise<string | null>`, `userMmtPath(): string`.

- [ ] **Step 1: Implement by mirroring `svclInstaller.ts`**

Copy `src/main/svclInstaller.ts` to `src/main/mmtInstaller.ts` and adapt:
- `ZIP_URL = 'https://www.nirsoft.net/utils/multimonitortool-x64.zip'` (the URL confirmed in Task 1).
- Rename exports: `onHelperStatus`→`onMmtStatus`, `getHelperStatus`→`getMmtStatus`, `userSvclPath`→`userMmtPath` (returns `.../helpers/MultiMonitorTool.exe`), `resolveSvclPath`→`resolveMmtPath`, `ensureSvcl`→`ensureMmt`, `installSvcl`→`installMmt`.
- Change the searched/renamed exe filename to `MultiMonitorTool.exe` (preserve the `findFile` case-insensitive fallback).
- Keep its own module-level `state`/`onChange` (independent of svcl).
- Reuse `userHelpersDir()` semantics (same `userData/helpers` dir is fine — different filenames).
- Keep log tags as `[mmt]`.

> No download is triggered here; `ensureMmt()` is called lazily from the IPC layer (Task 8) when the Display tab opens.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/mmtInstaller.ts
git commit -m "feat(display): lazy MultiMonitorTool installer"
```

---

## Task 5: `DisplayService` interface + factory + mock + swappable wrapper

**Files:**
- Create: `src/main/display/DisplayService.ts`, `src/main/display/MockDisplayService.ts`, `src/main/display/index.ts`
- (Real backend lands in Task 9; the factory falls back to mock until then.)

**Interfaces:**
- Produces:
  - `interface DisplayService { readonly isMock: boolean; getSnapshot(): Promise<DisplaySnapshot>; apply(monitors: MonitorState[]): Promise<ApplyResult>; dispose?(): void }`
  - `class SwappableDisplayService implements DisplayService { swap(next): void }`
  - `createDisplayService(): SwappableDisplayService`
  - `swapToMmtIfMock(svc: SwappableDisplayService, exePath: string): boolean`

- [ ] **Step 1: Write the interface**

`src/main/display/DisplayService.ts`:
```ts
import type { DisplaySnapshot, MonitorState, ApplyResult } from '@shared/types'

export interface DisplayService {
  readonly isMock: boolean
  getSnapshot(): Promise<DisplaySnapshot>
  apply(monitors: MonitorState[]): Promise<ApplyResult>
  dispose?(): void
}
```

- [ ] **Step 2: Write the mock**

`src/main/display/MockDisplayService.ts` — two monitors so the diagram has something to render:
```ts
import type { DisplayService } from './DisplayService'
import type { DisplaySnapshot, MonitorState, ApplyResult } from '@shared/types'

export class MockDisplayService implements DisplayService {
  readonly isMock = true
  private monitors: MonitorState[] = [
    { id: 'mock-laptop', device: '\\\\.\\DISPLAY1', name: 'Laptop Display', enabled: true, primary: true, x: 0, y: 0, width: 1920, height: 1200, refreshHz: 60 },
    { id: 'mock-dell', device: '\\\\.\\DISPLAY2', name: 'DELL U2719D', enabled: true, primary: false, x: 1920, y: 0, width: 2560, height: 1440, refreshHz: 144 }
  ]
  async getSnapshot(): Promise<DisplaySnapshot> {
    return { monitors: this.monitors.map((m) => ({ ...m })), mock: true }
  }
  async apply(monitors: MonitorState[]): Promise<ApplyResult> {
    const present = monitors.filter((m) => this.monitors.some((x) => x.id === m.id))
    this.monitors = this.monitors.map((m) => present.find((p) => p.id === m.id) ?? m)
    return { ok: true, appliedCount: present.length, missingIds: monitors.filter((m) => !present.includes(m)).map((m) => m.id) }
  }
}
```

- [ ] **Step 3: Write the swappable wrapper + factory**

`src/main/display/index.ts` — model after `audio/index.ts`. `createDisplayService()` returns a `SwappableDisplayService` wrapping `MockDisplayService` (Task 9 makes it prefer `MmtDisplayService` when `resolveMmtPath()` is non-null and adds the real `swapToMmtIfMock`). For now:
```ts
import type { DisplayService } from './DisplayService'
import type { DisplaySnapshot, MonitorState, ApplyResult } from '@shared/types'
import { MockDisplayService } from './MockDisplayService'

export type { DisplayService } from './DisplayService'

export class SwappableDisplayService implements DisplayService {
  constructor(private inner: DisplayService) {}
  get isMock(): boolean { return this.inner.isMock }
  swap(next: DisplayService): void { this.inner.dispose?.(); this.inner = next }
  getSnapshot(): Promise<DisplaySnapshot> { return this.inner.getSnapshot() }
  apply(monitors: MonitorState[]): Promise<ApplyResult> { return this.inner.apply(monitors) }
}

export function createDisplayService(): SwappableDisplayService {
  return new SwappableDisplayService(new MockDisplayService())
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/display/DisplayService.ts src/main/display/MockDisplayService.ts src/main/display/index.ts
git commit -m "feat(display): DisplayService interface, mock backend, swappable factory"
```

---

## Task 6: Pure MMT CSV parser → `MonitorState[]`

**Files:**
- Create: `src/main/display/mmtParse.ts`
- Test: `test/mmtParse.test.ts`

**Interfaces:**
- Consumes: `parseCsv`, `toNum`, `truthy` from `src/main/audio/svclParse.ts` (pure, already exported — reuse, don't duplicate).
- Produces: `parseMonitors(csv: string): MonitorState[]`.

> Headers, identity rules, and the name heuristic below are the **confirmed real values** from the Task 1 spike (run against the actual 3-monitor rig). `id` = Short Monitor ID; `device` = `\\.\DISPLAYn` (`Name`); `Disconnected=Yes` rows are dropped; friendly name prefers `Monitor String` unless it is "Generic PnP Monitor".

- [ ] **Step 1: Write the failing test**

`test/mmtParse.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseMonitors } from '../src/main/display/mmtParse'

// Real MultiMonitorTool /scomma header (subset of the 22 columns the parser reads).
const HEADER =
  'Resolution,Left-Top,Active,Disconnected,Primary,Frequency,Name,Monitor ID,Short Monitor ID,Monitor String,Monitor Name'
const CSV = [
  HEADER,
  '2560 X 1440,"0, 0",Yes,No,Yes,59,\\\\.\\DISPLAY1,MONITOR\\GSM772A\\{g}\\0003,GSM772A,Generic PnP Monitor,LG QHD',
  '1366 X 768,"2560, 167",Yes,No,No,60,\\\\.\\DISPLAY2,MONITOR\\AOC1970\\{g}\\0004,AOC1970,AOC 1970W,1970W',
  '1366 X 768,"2560, 0",No,No,No,0,\\\\.\\DISPLAY3,MONITOR\\SDC420A\\{g}\\0002,SDC420A,Lenovo DisplayHDR,ATNA60HS01-0 ',
  '1920 X 1080,"0, 0",No,Yes,No,0,\\\\.\\DISPLAY4,MONITOR\\OLD9\\{g}\\0009,OLD9,Old TV,Old TV'
].join('\n')

describe('parseMonitors', () => {
  it('maps real MMT columns to MonitorState (id=Short Monitor ID, device=Name)', () => {
    const ms = parseMonitors(CSV)
    // DISPLAY4 is Disconnected=Yes → excluded; 3 connected remain.
    expect(ms).toHaveLength(3)
    expect(ms[0]).toMatchObject({
      id: 'GSM772A', device: '\\\\.\\DISPLAY1', name: 'LG QHD',
      enabled: true, primary: true, x: 0, y: 0, width: 2560, height: 1440, refreshHz: 59
    })
  })
  it('uses Monitor String for the name unless it is Generic PnP Monitor', () => {
    const ms = parseMonitors(CSV)
    expect(ms.find((m) => m.id === 'AOC1970')!.name).toBe('AOC 1970W') // Monitor String
    expect(ms.find((m) => m.id === 'GSM772A')!.name).toBe('LG QHD') // falls back to Monitor Name
    expect(ms.find((m) => m.id === 'SDC420A')!.name).toBe('Lenovo DisplayHDR')
  })
  it('marks a disabled monitor (Active=No) and drops its zero frequency', () => {
    const lenovo = parseMonitors(CSV).find((m) => m.id === 'SDC420A')!
    expect(lenovo.enabled).toBe(false)
    expect(lenovo.refreshHz).toBeUndefined()
  })
  it('ignores blank/garbage rows without throwing', () => {
    expect(parseMonitors('')).toEqual([])
    expect(parseMonitors('Resolution,Name\n,')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/mmtParse.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the parser**

`src/main/display/mmtParse.ts`:
```ts
import type { MonitorState } from '@shared/types'
import { parseCsv, toNum, truthy } from '../audio/svclParse'

/** "2560 X 1440" → { width, height }; tolerant of 'x'/spacing. */
function parseResolution(v: string): { width: number; height: number } {
  const m = /(-?\d+)\s*[xX]\s*(-?\d+)/.exec(v ?? '')
  return { width: m ? Number(m[1]) : 0, height: m ? Number(m[2]) : 0 }
}

/** "1920, 0" → { x, y }. */
function parsePosition(v: string): { x: number; y: number } {
  const m = /(-?\d+)\s*,\s*(-?\d+)/.exec(v ?? '')
  return { x: m ? Number(m[1]) : 0, y: m ? Number(m[2]) : 0 }
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (row[k] && row[k] !== '') return row[k]
  return ''
}

/** Friendly label: Monitor String unless empty/generic, else Monitor Name, else fallback. */
function friendlyName(row: Record<string, string>, fallback: string): string {
  const str = pick(row, ['Monitor String'])
  if (str && str.toLowerCase() !== 'generic pnp monitor') return str
  return pick(row, ['Monitor Name', 'Short Monitor ID']) || fallback
}

/** Pure: MultiMonitorTool /scomma CSV → MonitorState[]. Never throws. */
export function parseMonitors(csv: string): MonitorState[] {
  const out: MonitorState[] = []
  for (const row of parseCsv(csv)) {
    if (truthy(pick(row, ['Disconnected']))) continue // not physically present
    const device = pick(row, ['Name']) // \\.\DISPLAYn — the apply command target
    const id = pick(row, ['Short Monitor ID', 'Monitor ID', 'Name']) // stable match key
    if (!id) continue
    const { width, height } = parseResolution(pick(row, ['Resolution']))
    const { x, y } = parsePosition(pick(row, ['Left-Top']))
    const freq = toNum(pick(row, ['Frequency']))
    const refreshHz = freq && freq > 0 ? freq : undefined
    out.push({
      id, device,
      name: friendlyName(row, id),
      enabled: truthy(pick(row, ['Active'])),
      primary: truthy(pick(row, ['Primary'])),
      x, y, width, height,
      ...(refreshHz !== undefined ? { refreshHz } : {})
    })
  }
  return out
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/mmtParse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/display/mmtParse.ts test/mmtParse.test.ts
git commit -m "feat(display): pure MultiMonitorTool CSV parser"
```

---

## Task 7: Pure apply-planner (validate + build command argv)

**Files:**
- Create: `src/main/display/displayPlan.ts`
- Test: `test/displayPlan.test.ts`

**Interfaces:**
- Consumes: `MonitorState` from `@shared/types`.
- Produces:
  - `validateArrangement(monitors: MonitorState[]): string | null` (error message, or null when valid)
  - `planApply(target: MonitorState[], connected: MonitorState[]): { commands: string[][]; missingIds: string[]; error?: string }`
  - Matching is by stable `id`; every emitted command targets the **connected** monitor's current `device` (`\\.\DISPLAYn`), never the target's stored device.

- [ ] **Step 1: Write the failing tests**

`test/displayPlan.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validateArrangement, planApply } from '../src/main/display/displayPlan'
import type { MonitorState } from '../src/shared/types'

// device deliberately differs from id, so tests prove commands target `device`.
const m = (id: string, o: Partial<MonitorState> = {}): MonitorState => ({
  id, device: `dev-${id}`, name: id, enabled: true, primary: false,
  x: 0, y: 0, width: 1920, height: 1080, ...o
})

describe('validateArrangement', () => {
  it('rejects all-disabled', () => {
    expect(validateArrangement([m('a', { enabled: false })])).toMatch(/enabled/i)
  })
  it('rejects zero or multiple primaries among enabled', () => {
    expect(validateArrangement([m('a')])).toMatch(/primary/i)
    expect(validateArrangement([m('a', { primary: true }), m('b', { primary: true })])).toMatch(/primary/i)
  })
  it('accepts exactly one enabled primary', () => {
    expect(validateArrangement([m('a', { primary: true }), m('b')])).toBeNull()
  })
})

describe('planApply', () => {
  it('skips missing monitors and reports them', () => {
    const target = [m('a', { primary: true }), m('gone', { x: 1920 })]
    const { missingIds } = planApply(target, [m('a')])
    expect(missingIds).toEqual(['gone'])
  })
  it('refuses when every present monitor would be disabled', () => {
    const { error, commands } = planApply([m('a', { enabled: false })], [m('a')])
    expect(error).toMatch(/turn off every/i)
    expect(commands).toEqual([])
  })
  it('promotes a primary when the captured primary is disconnected', () => {
    const target = [m('p', { primary: true }), m('b', { x: 1920 })]
    const { commands } = planApply(target, [m('b')])
    const setMon = commands.find((c) => c[0] === '/SetMonitors')!
    expect(setMon.some((a) => /SetAsPrimary=1/.test(a))).toBe(true)
  })
  it('targets the connected device, even if the target stored a stale one', () => {
    // target 'a' stored device 'dev-OLD'; connected reports 'dev-NEW'.
    const target = [{ ...m('a', { primary: true }), device: 'dev-OLD' }]
    const { commands } = planApply(target, [{ ...m('a'), device: 'dev-NEW' }])
    const setMon = commands.find((c) => c[0] === '/SetMonitors')!
    expect(setMon.some((a) => a.startsWith('Name=dev-NEW'))).toBe(true)
    expect(commands).toContainEqual(['/enable', 'dev-NEW'])
  })
  it('builds enable, SetMonitors (position+primary), and disable commands by device', () => {
    const target = [
      m('a', { primary: true, x: 0 }),
      m('b', { x: 2560 }),
      m('c', { enabled: false })
    ]
    const { commands } = planApply(target, [m('a'), m('b'), m('c')])
    expect(commands).toContainEqual(['/enable', 'dev-a'])
    expect(commands).toContainEqual(['/enable', 'dev-b'])
    expect(commands).toContainEqual(['/disable', 'dev-c'])
    const setMon = commands.find((c) => c[0] === '/SetMonitors')!
    expect(setMon).toContain('Name=dev-a PositionX=0 PositionY=0 SetAsPrimary=1')
    expect(setMon).toContain('Name=dev-b PositionX=2560 PositionY=0')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/displayPlan.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the planner**

`src/main/display/displayPlan.ts`:
```ts
import type { MonitorState } from '@shared/types'

/** Returns an error message if the arrangement is invalid, else null. */
export function validateArrangement(monitors: MonitorState[]): string | null {
  const enabled = monitors.filter((m) => m.enabled)
  if (enabled.length === 0) return 'At least one display must stay enabled.'
  const primaries = enabled.filter((m) => m.primary)
  if (primaries.length !== 1) return 'Exactly one display must be primary.'
  return null
}

/**
 * Pure: turn a target arrangement into an ordered list of MultiMonitorTool command
 * argv arrays, applied only to currently-connected monitors. Monitors are matched by
 * stable `id`; every command targets the CONNECTED monitor's current `device`
 * (\\.\DISPLAYn), since that handle shuffles across enable/disable and the stored one
 * may be stale. Missing monitors are skipped and reported. If the captured primary is
 * disconnected, the first present enabled monitor is promoted so the result is valid.
 */
export function planApply(
  target: MonitorState[],
  connected: MonitorState[]
): { commands: string[][]; missingIds: string[]; error?: string } {
  const deviceById = new Map(connected.map((m) => [m.id, m.device]))
  const missingIds = target.filter((m) => !deviceById.has(m.id)).map((m) => m.id)
  // Re-resolve each present monitor's device from the live snapshot.
  const present = target
    .filter((m) => deviceById.has(m.id))
    .map((m) => ({ ...m, device: deviceById.get(m.id)! }))

  const enabled = present.filter((m) => m.enabled)
  if (enabled.length === 0) {
    return { commands: [], missingIds, error: 'This profile would turn off every connected display.' }
  }
  // Ensure exactly one primary among the present-enabled set.
  if (!enabled.some((m) => m.primary)) enabled[0].primary = true
  else {
    let seen = false
    for (const mon of enabled) {
      if (mon.primary && seen) mon.primary = false
      else if (mon.primary) seen = true
    }
  }

  const commands: string[][] = []
  for (const mon of enabled) commands.push(['/enable', mon.device])
  // Topology only: position + primary, NO width/height/frequency, so a disabled
  // monitor's freed bandwidth lets the survivors renegotiate their best mode.
  const blocks = enabled.map(
    (mon) => `Name=${mon.device} PositionX=${mon.x} PositionY=${mon.y}${mon.primary ? ' SetAsPrimary=1' : ''}`
  )
  commands.push(['/SetMonitors', ...blocks])
  // Disable unwanted monitors LAST so the kept ones are already positioned.
  for (const mon of present.filter((m) => !m.enabled)) commands.push(['/disable', mon.device])
  return { commands, missingIds }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/displayPlan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/display/displayPlan.ts test/displayPlan.test.ts
git commit -m "feat(display): pure apply-planner with validation and missing-monitor skipping"
```

---

## Task 8: Wire `display:*` IPC handlers

**Files:**
- Modify: `src/main/ipc.ts`

**Interfaces:**
- Consumes: `SwappableDisplayService` (Task 5), `ensureMmt`/`getMmtStatus` (Task 4), `DisplaySnapshot`/`ApplyResult`/`DisplayProfile` (Task 2).
- Produces: registered handlers for `getDisplaySnapshot`, `applyDisplay`, `ensureDisplayHelper`, `getDisplayHelperStatus`; a `broadcastDisplaySnapshot()` helper.

- [ ] **Step 1: Extend `registerIpc` to take the display service**

Change the signature to `registerIpc(audio: SwappableAudioService, display: SwappableDisplayService)`. Import `getMmtStatus`, `ensureMmt` from `./mmtInstaller`, `swapToMmtIfMock` from `./display`, and the relevant types.

- [ ] **Step 2: Add a display-snapshot broadcaster**

Inside `registerIpc`, alongside `broadcastSnapshot`:
```ts
const broadcastDisplaySnapshot = async (): Promise<void> => {
  try {
    getWindow()?.webContents.send(IPC.displaySnapshotChanged, await display.getSnapshot())
  } catch (err) {
    log.error('[ipc] broadcastDisplaySnapshot failed:', err)
  }
}
```

- [ ] **Step 3: Register the handlers**

```ts
ipcMain.handle(IPC.getDisplaySnapshot, async (): Promise<DisplaySnapshot> => {
  try { return await display.getSnapshot() }
  catch (err) { log.error('[ipc] getDisplaySnapshot failed:', err); return { monitors: [], mock: false } }
})

ipcMain.handle(IPC.getDisplayHelperStatus, () => getMmtStatus())

// Lazy: the renderer calls this when the Display tab first opens. Idempotent —
// downloads MultiMonitorTool only if missing, then hot-swaps the mock backend.
ipcMain.handle(IPC.ensureDisplayHelper, async () => {
  const path = await ensureMmt()
  if (path && swapToMmtIfMock(display, path)) await broadcastDisplaySnapshot()
  return getMmtStatus()
})

ipcMain.handle(IPC.applyDisplay, async (_e, arg: unknown): Promise<ApplyResult> => {
  try {
    let monitors: MonitorState[] | undefined
    if (typeof arg === 'string') {
      const prof = settings().get().displayProfiles.find((p) => p.id === arg)
      monitors = prof?.monitors
    } else if (Array.isArray(arg)) {
      monitors = arg as MonitorState[]
    }
    if (!monitors || monitors.length === 0) {
      return { ok: false, appliedCount: 0, missingIds: [], error: 'Nothing to apply.' }
    }
    return await display.apply(monitors)
  } catch (err) {
    log.error('[ipc] applyDisplay failed:', err)
    return { ok: false, appliedCount: 0, missingIds: [], error: 'Apply failed.' }
  } finally {
    await broadcastDisplaySnapshot()
  }
})
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: FAIL at the `registerIpc(audio)` call site in `index.ts` (fixed in Task 10). It should otherwise compile within `ipc.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(display): register display IPC handlers (lazy helper, apply, snapshot)"
```

---

## Task 9: Real `MmtDisplayService` + factory swap

**Files:**
- Create: `src/main/display/MmtDisplayService.ts`
- Modify: `src/main/display/index.ts`

**Interfaces:**
- Consumes: `parseMonitors` (Task 6), `planApply` (Task 7), `resolveMmtPath` (Task 4).
- Produces: `class MmtDisplayService implements DisplayService`; real `swapToMmtIfMock`; `createDisplayService()` prefers MMT when present.

- [ ] **Step 1: Implement the real service**

`src/main/display/MmtDisplayService.ts` — model robustness on `SvclAudioService` (timeout, `windowsHide`, never throw on read; reads degrade to last-known). Enumerate by writing `/scomma` to a temp file then reading it (guaranteed across MMT versions); apply by running each planned command sequentially:
```ts
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { DisplayService } from './DisplayService'
import type { DisplaySnapshot, MonitorState, ApplyResult } from '@shared/types'
import { parseMonitors } from './mmtParse'
import { planApply } from './displayPlan'
import { log } from '../logger'

const execFileAsync = promisify(execFile)

export class MmtDisplayService implements DisplayService {
  readonly isMock = false
  private lastGood: DisplaySnapshot = { monitors: [], mock: false }

  constructor(private readonly exePath: string) {
    if (!existsSync(exePath)) throw new Error(`MultiMonitorTool.exe not found at ${exePath}`)
  }

  private run(args: string[]): Promise<void> {
    return execFileAsync(this.exePath, args, { windowsHide: true, timeout: 10_000 }).then(() => undefined)
  }

  async getSnapshot(): Promise<DisplaySnapshot> {
    const out = join(tmpdir(), `mmt-${process.pid}-${this.lastGood.monitors.length}.csv`)
    try {
      await this.run(['/scomma', out])
      const csv = readFileSync(out, 'utf-8')
      this.lastGood = { monitors: parseMonitors(csv), mock: false }
      return this.lastGood
    } catch (err) {
      log.error('[mmt] getSnapshot failed; returning last-known monitors:', err)
      return this.lastGood
    } finally {
      rmSync(out, { force: true })
    }
  }

  async apply(monitors: MonitorState[]): Promise<ApplyResult> {
    const connected = (await this.getSnapshot()).monitors // live; carries current devices
    const { commands, missingIds, error } = planApply(monitors, connected)
    if (error) return { ok: false, appliedCount: 0, missingIds, error }
    try {
      for (const cmd of commands) await this.run(cmd)
      return { ok: true, appliedCount: monitors.length - missingIds.length, missingIds }
    } catch (err) {
      log.error('[mmt] apply failed:', err)
      return { ok: false, appliedCount: 0, missingIds, error: 'Apply failed.' }
    }
  }
}
```

> Adjust the `/scomma`/`/SetMonitors` specifics only if Task 1 found different syntax. Keep the temp-file enumeration regardless.

- [ ] **Step 2: Make the factory prefer MMT**

In `src/main/display/index.ts`, mirror `audio/index.ts`: import `MmtDisplayService` and `resolveMmtPath`; in `createDisplayService()` use the real backend when `process.platform === 'win32'` and `resolveMmtPath()` is non-null (wrapped in try/catch → mock on failure); implement:
```ts
export function swapToMmtIfMock(svc: SwappableDisplayService, exePath: string): boolean {
  if (!svc.isMock) return false
  try { svc.swap(new MmtDisplayService(exePath)); log.info('[display] swapped to MultiMonitorTool backend'); return true }
  catch (err) { log.warn('[display] swap to MMT failed:', err); return false }
}
```
(Add the `log` import.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS within these files (the `index.ts` call site is still Task 10).

- [ ] **Step 4: Commit**

```bash
git add src/main/display/MmtDisplayService.ts src/main/display/index.ts
git commit -m "feat(display): real MultiMonitorTool backend + factory swap"
```

---

## Task 10: Wire the display service into main + stream helper status

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `createDisplayService` (Task 5/9), `onMmtStatus` (Task 4), updated `registerIpc` (Task 8).

- [ ] **Step 1: Build the service and pass it to `registerIpc`**

In `app.whenReady()`, after `const audio = createAudioService()`:
```ts
const display = createDisplayService()
const { broadcastSnapshot } = registerIpc(audio, display)
```
Add imports: `import { createDisplayService } from './display'` and `import { onMmtStatus } from './mmtInstaller'`.

- [ ] **Step 2: Stream MMT helper status to the panel**

Near the existing `onHelperStatus(...)` wiring add:
```ts
onMmtStatus((status) => getWindow()?.webContents.send(IPC.displayHelperStatusChanged, status))
```
**Do NOT call `ensureMmt()` here** — provisioning stays lazy (renderer triggers it via `ensureDisplayHelper` when the Display tab opens).

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(display): wire display service into main, stream MMT status"
```

---

## Task 11: Expose display API on the preload bridge

**Files:**
- Modify: `src/preload/index.ts`

**Interfaces:**
- Produces (on `window.sounddeck`): `getDisplaySnapshot`, `getDisplayHelperStatus`, `ensureDisplayHelper`, `applyDisplay`, `onDisplaySnapshotChanged`, `onDisplayHelperStatusChanged`.

- [ ] **Step 1: Add methods + events**

Import `DisplaySnapshot`, `ApplyResult`, `DisplayProfile`, `MonitorState` from `../shared/types`. Add to `api`:
```ts
  getDisplaySnapshot: (): Promise<DisplaySnapshot> => ipcRenderer.invoke(IPC.getDisplaySnapshot),
  getDisplayHelperStatus: (): Promise<HelperStatus> => ipcRenderer.invoke(IPC.getDisplayHelperStatus),
  ensureDisplayHelper: (): Promise<HelperStatus> => ipcRenderer.invoke(IPC.ensureDisplayHelper),
  applyDisplay: (arg: string | MonitorState[]): Promise<ApplyResult> => ipcRenderer.invoke(IPC.applyDisplay, arg),
  onDisplaySnapshotChanged: (cb: (s: DisplaySnapshot) => void): (() => void) => subscribe(IPC.displaySnapshotChanged, cb),
  onDisplayHelperStatusChanged: (cb: (s: HelperStatus) => void): (() => void) => subscribe(IPC.displayHelperStatusChanged, cb),
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (`SoundDeckApi` type widens automatically; `src/preload/index.d.ts` needs no change).

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(display): expose display API on the preload bridge"
```

---

## Task 12: Read-only layout diagram component

**Files:**
- Create: `src/renderer/src/components/LayoutDiagram.tsx`

**Interfaces:**
- Consumes: `MonitorState[]`.
- Produces: `LayoutDiagram({ monitors }: { monitors: MonitorState[] })` — to-scale rectangles, primary star, resolution + refresh label, dimmed when disabled. Read-only (the canvas Phase B makes interactive).

- [ ] **Step 1: Implement**

Compute the bounding box over enabled monitors' `x/y/width/height`, scale to fit a fixed area (e.g. 280×150 px) preserving aspect, and absolutely-position each rectangle. Each shows `name`, `width×height`, and `· {refreshHz} Hz` when present; a `★` (lucide `Star`) on `primary`; `opacity-40` + dashed border when `!enabled`. Follow App.tsx's glass/tailwind idiom (`rounded`, `border-white/10`, `text-white/70`). Guard the empty/zero-area case (render an "No displays detected" placeholder).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/LayoutDiagram.tsx
git commit -m "feat(display): read-only to-scale layout diagram"
```

---

## Task 13: Display profiles row (chips + "Save current")

**Files:**
- Create: `src/renderer/src/components/DisplayProfilesRow.tsx`

**Interfaces:**
- Consumes: `DisplayProfile[]`, current `MonitorState[]` (live snapshot).
- Produces: `DisplayProfilesRow({ profiles, monitors, onApply, onChange })` where `onApply(p: DisplayProfile)` and `onChange(next: DisplayProfile[])`.

- [ ] **Step 1: Implement**

Mirror `ProfilesRow.tsx`'s chip + composer visuals exactly (same classes). Chips: tap to `onApply(p)`, ✕ to remove. The composer's only mode for Phase A is **Save current**: a name input + Create button that snapshots the live `monitors` into `{ id: crypto.randomUUID(), name, monitors }` and calls `onChange([...profiles, profile])`. Disable Create when the name is empty or `monitors` is empty. Leave a clearly-commented placeholder where Phase B's "Build manually" tab/editor will mount (matches spec §9).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/DisplayProfilesRow.tsx
git commit -m "feat(display): display profiles row with save-current composer"
```

---

## Task 14: `DisplayView` (helper banner + diagram + profiles + apply notes)

**Files:**
- Create: `src/renderer/src/components/DisplayView.tsx`

**Interfaces:**
- Consumes: `api` bridge (Task 11), `LayoutDiagram` (Task 12), `DisplayProfilesRow` (Task 13), `DisplaySnapshot`, `HelperStatus`, `DisplayProfile`, `Settings`.
- Produces: `DisplayView({ settings, onUpdateSettings }: { settings: Settings; onUpdateSettings: (patch: Partial<Settings>) => void })`.

- [ ] **Step 1: Implement**

Self-contained tab body:
- On mount: call `api.ensureDisplayHelper().then(setHelper)` (triggers the lazy download) and `api.getDisplaySnapshot().then(setSnap)`. Subscribe to `onDisplaySnapshotChanged` and `onDisplayHelperStatusChanged`; unsubscribe on unmount.
- Render the **helper banner** reusing the svcl banner copy/markup from `App.tsx` (downloading / unsupported / failed-retry), shown only while `helper?.mock`. The retry button calls `api.ensureDisplayHelper().then(setHelper)`.
- Render `LayoutDiagram monitors={snap?.monitors ?? []}`.
- Render `DisplayProfilesRow` with `profiles={settings.displayProfiles}`, `monitors={snap?.monitors ?? []}`, `onApply={apply}`, `onChange={(next) => onUpdateSettings({ displayProfiles: next })}`.
- `apply(p)`: `api.applyDisplay(p.id).then(setApplyNote)`; show a brief inline note when `missingIds.length > 0` (`"N display(s) in this profile aren't connected"`) or `error`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/DisplayView.tsx
git commit -m "feat(display): DisplayView — banner, diagram, profiles, apply notes"
```

---

## Task 15: `Audio | Display` tab shell in App

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `DisplayView` (Task 14).

- [ ] **Step 1: Add the top-level mode tabs**

Add `const [mode, setMode] = useState<'audio' | 'display'>('audio')`. In the `onPanelShown` handler, reset `setMode('audio')` (ephemeral — not persisted, per spec §6). Render a segmented `Audio | Display` control at the top of the **main** view (reuse the existing `TabButton` look or a sibling styled identically). When `mode === 'display'`, render `<DisplayView settings={settings} onUpdateSettings={(patch) => api.updateSettings(patch).then(setSettings).catch(logErr)} />` in place of the audio body; otherwise render today's audio body unchanged. Keep the Settings deep-link and header intact.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(display): Audio | Display tab shell wired to DisplayView"
```

---

## Task 16: Full verification + build the exe

**Files:** none (verification).

- [ ] **Step 1: Run the whole check suite**

Run: `npm run check`  (typecheck + vitest + build)
Expected: PASS — all unit tests green, build succeeds.

- [ ] **Step 2: Build the packaged exe**

Per project memory, prepare the release exe after changes:
Run: `npm run build` then the project's packaging step (`release/SoundDeck/SoundDeck.exe`).
Do **not** launch it unless asked.

- [ ] **Step 3: Manual smoke (when the user runs it on the dual-monitor box)**

Confirm: Display tab triggers the one-time MMT download (banner → ready); diagram matches the real layout with correct resolution + refresh; "Save current" creates a chip; applying a saved "laptop off, small right / big left" profile produces that arrangement; a profile referencing an unplugged monitor applies the rest and shows the missing note; everything is reversible from Windows Settings.

- [ ] **Step 4: Commit any fixes, then finish the branch**

Use `superpowers:finishing-a-development-branch` to merge/PR `feature/display-control`.

---

## Self-Review

**Spec coverage:**
- §2 helper/lazy download → Tasks 1, 4, 8 (ensure), 10 (no eager call). ✅
- §3 data model + coercion → Tasks 2, 3. ✅
- §4 enumerate / topology-only apply / identity match / validate-before-apply → Tasks 6, 7, 9. ✅
- §5 IPC channels + `ApplyResult` → Tasks 2, 8, 11. ✅
- §6 tab shell, read-only diagram, profiles row, missing note, ephemeral tab → Tasks 12, 13, 14, 15. ✅
- §7 error handling (mock fallback, no partial-destructive, unsupported) → Tasks 5, 7, 9. ✅
- §8 tests (parser, planner, coercion, mock) → Tasks 3, 6, 7, 5. ✅
- §9 Phase-B forward-compat (coordinate-driven diagram, arbitrary-`MonitorState[]` apply, build-manually stub) → Tasks 7, 9, 12, 13. ✅

**Placeholder scan:** Task 1 is an intentional empirical spike (no code); all code steps contain concrete implementations. No TBD/TODO in code steps. ✅

**Type consistency:** `MonitorState`/`DisplaySnapshot`/`DisplayProfile`/`ApplyResult` defined in Task 2 are used verbatim downstream; `planApply(target, connectedIds: Set<string>)`, `validateArrangement`, `parseMonitors`, `ensureMmt`/`installMmt`/`resolveMmtPath`, `createDisplayService`/`swapToMmtIfMock` names match across tasks. ✅

**Known risk:** exact MultiMonitorTool flags/columns are assumption-pinned until Task 1 confirms them; the parser is header-tolerant and the planner is argv-structural, so only `mmtParse` fixtures and the thin `MmtDisplayService` command strings may need adjustment — contained to Tasks 6 and 9.
