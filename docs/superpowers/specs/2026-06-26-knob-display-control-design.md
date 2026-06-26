# Knob — Display Control (Phase A), foundation for the visual editor (Phase B)

Date: 2026-06-26
Status: Approved (design)

## 1. Scope

Add a **Display** tab to the panel that lets the user see their monitor layout and
save/apply named **display profiles** (which monitors are on, where they sit, which is
primary).

- **Phase A (this spec):** capture the *current* arrangement into named profiles; apply
  them in one tap; show a read-only, to-scale layout diagram with live resolution +
  refresh.
- **Phase B (later, out of scope here):** make the diagram draggable to author *new*
  arrangements (drag to reposition, toggle on/off, pick primary), plus a "Build manually"
  composer.

Phase B is **purely additive**: it reuses A's data model, apply engine, validation, IPC,
and the very rectangles A draws. A is deliberately built so B requires no rework.

Explicitly out of scope: built-in Win+P-style presets (the user already has Win+P);
forcing resolution/refresh on apply (topology only — see §4).

## 2. Architecture (mirrors the existing audio stack)

```
MultiMonitorTool.exe (NirSoft, lazy download)      <- analog of svcl.exe
        |
DisplayService  (enumerate -> MonitorState[];  apply MonitorState[] -> OS)
        |  IPC (display:*)
Renderer:  Audio | Display tabs  ->  DisplayView (diagram + ProfilesRow)
```

- **Helper provisioning** reuses the existing `HelperState` / `HelperStatus` pattern, but
  as a *second, independent* helper, downloaded **lazily** the first time the Display tab
  is opened. The audio (svcl) provisioning path is untouched.
- New `mmtInstaller.ts` parallels `svclInstaller.ts`.
- New `DisplayService` (real) parallels `SvclAudioService`; `MockDisplayService` parallels
  `MockAudioService` for non-Windows / dev.

### Helper: MultiMonitorTool

- NirSoft freeware (~100 KB), same author/licensing model as svcl. License forbids
  bundling inside another product, so it is **downloaded on first use** from the official
  `https://www.nirsoft.net` over HTTPS, extracted with PowerShell `Expand-Archive` (same
  as svcl), and cached under `userData/helpers`.
- Lazy: not fetched until the Display tab is first opened. Audio-only users never download
  it.
- Path resolution mirrors `resolveSvclPath()` (packaged prefers userData copy; never
  consults `process.cwd()` in packaged builds).

## 3. Data model (`src/shared/types.ts`)

```ts
export interface MonitorState {
  id: string            // stable identity (MMT monitor name / serial), NOT the OS index
  name: string          // "DELL U2719D"
  enabled: boolean
  primary: boolean
  x: number; y: number          // desktop position of top-left
  width: number; height: number // current resolution (captured; NOT forced on apply)
  refreshHz?: number            // shown in the diagram
}

export interface DisplaySnapshot {
  monitors: MonitorState[]
  mock: boolean
}

export interface DisplayProfile {
  id: string            // crypto.randomUUID()
  name: string
  monitors: MonitorState[]
}
```

`Settings` gains `displayProfiles: DisplayProfile[]`, validated by `coerceSettings` with
the same rigor as audio `profiles` and a cap (`DISPLAY_PROFILES_MAX = 24`). Malformed
profiles/monitors are dropped, names sanitized (control chars stripped, trimmed, capped),
never thrown on.

## 4. Backend behavior

### Enumerate
- Run MultiMonitorTool `/scomma "" /Columns <explicit columns>` -> CSV -> parse to
  `MonitorState[]`.
- Same robustness contract as svcl: a failed/slow/timed-out call NEVER crashes the app;
  reads degrade to the last-known snapshot.

### Apply (`MonitorState[]` -> OS), **topology only**
- For each profile monitor matched (by stable id) to a connected monitor: enable/disable,
  set position, set primary — via MultiMonitorTool `/SetMonitors`, `/enable` `/disable`,
  `/SetPrimary` as appropriate.
- **Resolution is captured but NOT forced.** Rationale: after disabling a
  bandwidth-hungry monitor (e.g. on a laptop dock/USB-C path), the survivors should be
  free to renegotiate to their *best* available mode. Forcing the stored resolution would
  risk pinning them at the lower mode they were stuck at while the extra monitor was
  attached.

### Identity matching on apply
- Match profile monitors to currently-connected monitors by **stable id**.
- **Missing monitors are skipped** (best-effort apply of what is present). No crash, no
  black screen. The UI notes how many monitors in the profile aren't connected.

### Validation before apply (shared with Phase B)
- At least one monitor must remain enabled; exactly one primary.
- If applying a profile would disable every monitor, refuse and surface an error. Validate
  *before* issuing any command so there is no partial-destructive state.

## 5. IPC (`src/shared/types.ts` `IPC` map — new channels; audio channels untouched)

```
renderer -> main (invoke):
  display:getSnapshot        -> DisplaySnapshot
  display:apply              (profileId | MonitorState[]) -> ApplyResult
  display:installHelper       (retry the MMT download)
  display:getHelperStatus    -> HelperStatus

main -> renderer (send):
  display:snapshotChanged    (monitors hot-plugged / changed)
  display:helperStatusChanged
```

- Display profiles are persisted through the **existing** `settings:update` channel
  (the `displayProfiles` array), exactly like audio profiles — no new CRUD channels.
- `ApplyResult = { ok: boolean; appliedCount: number; missingIds: string[]; error?: string }`
  so the UI can show partial-apply notes.
- Apply is guarded against re-entrancy / debounced, like the audio writes.

## 6. UI

### Tab shell
- A segmented **Audio | Display** control at the top of the panel.
- Audio view = today's panel verbatim.
- Active tab is **ephemeral** (resets to Audio on each summon), not persisted — keeps
  `settings.json` clean. Revisit if a sticky tab is wanted later.

### DisplayView
1. **Helper status banner** — reuses the svcl "downloading / failed + Retry" component,
   shown only while MultiMonitorTool isn't ready.
2. **Layout diagram** — monitor rectangles drawn **to scale** from `x/y/width/height`,
   positioned relative to each other like the Windows display panel. Each rectangle shows:
   name, **current resolution + refresh** (e.g. "2560x1440 - 144 Hz"), a star on the
   primary, dimmed style when disabled. **Read-only in Phase A** — this is the canvas
   Phase B makes interactive.
3. **ProfilesRow (display variant)** — same chip pattern as audio: tap a chip to apply,
   x to delete, **"Save current"** composer that snapshots the live arrangement into a
   named profile. (Manual build deferred to Phase B.)
4. **Inline note** under a chip after apply if any monitor was missing.

### Reuse
- Generalize the existing `ProfilesRow` chip/composer shell (extract the shared visual
  shell) rather than fork it, so audio and display chips stay visually identical.

## 7. Error handling

- MMT missing/offline -> Display tab fully functional in **mock** mode (a sample
  2-monitor layout) with the Retry banner, mirroring svcl. Audio unaffected.
- Apply failure (validation, MMT error, all-monitors-would-disable) -> `ApplyResult.error`,
  surfaced as a brief inline toast. **No partial-destructive state** (validate before
  issuing commands).
- Non-Windows / dev -> `MockDisplayService`, helper state `unsupported`.

## 8. Testing (Vitest, matching existing svcl tests)

- **Parser unit tests** — MMT CSV -> `MonitorState[]` (primary flag, disabled monitors,
  position/refresh parsing, garbage rows).
- **Apply-planner unit tests** — `MonitorState[]` -> ordered MMT command list; missing-id
  skipping; validation rejects (no primary / all-disabled).
- **`coerceSettings` tests** — malformed `DisplayProfile[]` dropped/sanitized, cap
  enforced.
- **MockDisplayService** keeps the renderer runnable cross-platform.

## 9. Phase-B forward-compat (designed into A, not implemented here)

- Diagram renders from coordinates -> B adds drag handlers to the *same* rectangles.
- Apply takes arbitrary `MonitorState[]` -> B feeds edited (novel) arrangements; A only
  ever feeds captured ones.
- Validation + `ApplyResult` already handle author-time mistakes B can produce.
- A "Build manually" tab stub in the composer is where B's editor mounts.
