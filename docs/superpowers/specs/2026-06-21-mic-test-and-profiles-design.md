# Mic Test + Device Profiles — Design

Date: 2026-06-21
Status: Approved

Two independent renderer-side features. No new IPC; profiles persist through the
existing `updateSettings` path.

## A. Mic level meter

**Goal:** let the user confirm an input device is picking up sound via a live inline
level meter, mirroring the existing per-output test tone.

- **`src/renderer/src/lib/micMeter.ts`**
  - `rmsLevel(data: Uint8Array): number` — PURE. Given an AnalyserNode time-domain byte
    buffer (centered at 128), returns a normalized `0..1` RMS level. Unit-tested.
  - `startMicMeter(matchTerms: string[], onLevel: (level: number) => void, opts?: {
    durationMs?: number; onEnd?: () => void }): { stop: () => void }`
    - Enumerates `audioinput`, matches a device by label using the same exact-then-loose
      strategy as `testTone.ts`.
    - `getUserMedia({ audio: { deviceId: { exact } } })` (falls back to default mic match
      if no id), wires an `AnalyserNode` (fftSize 1024), runs a `requestAnimationFrame`
      loop calling `onLevel(rmsLevel(buffer))`.
    - Auto-stops after `durationMs` (default 6000), calling `onEnd`; `stop()` cancels the
      rAF, stops all tracks, and closes the `AudioContext`. Idempotent.
- **`DeviceCard.tsx`**
  - New optional prop `onMeter?: (onLevel: (level: number) => void) => () => void`
    (returns a stop fn). Present only for input devices.
  - When `onMeter` is set, the existing wave-icon click starts metering instead of a tone;
    while live, the card renders a thin animated level bar under the device name driven by
    the latest level. Re-click stops early. Output cards keep `onTest` behavior unchanged.
  - The card owns `metering` + `level` state and the stop handle; cleans up on unmount.
- **`App.tsx`**
  - Output tab: pass `onTest` (today's test tone).
  - Input tab: pass `onMeter={(onLevel) => startMicMeter([d.description, d.name].filter(Boolean), onLevel).stop ...}`
    wiring the card's level callback to `startMicMeter`, returning its `stop`.

**Tests:** `test/micMeter.test.ts` — `rmsLevel` (silence→~0, full-swing→high, rounding/clamp).
The getUserMedia/Analyser glue is untested integration, consistent with `testTone.ts`.

## B. Device profiles

**Goal:** save named output+input device combinations and apply both defaults in one tap.

- **Types (`src/shared/types.ts`)**
  ```ts
  export interface Profile {
    id: string        // crypto.randomUUID()
    name: string
    outputId: string  // svcl device id ending in \Render
    inputId: string   // svcl device id ending in \Capture
  }
  ```
  - Add `profiles: Profile[]` to `Settings`; `profiles: []` to `DEFAULT_SETTINGS`.
- **Coercion (`src/main/settingsSchema.ts`)**
  - Add a `profiles(v)` filter: keep entries where `id`, `name`, `outputId`, `inputId` are
    all non-empty strings; sanitize `name` like aliases (strip control chars, trim, cap 64);
    drop entries whose name sanitizes to empty; cap the list at 24 profiles.
  - Wire into `coerceSettings` return. Extend `test/settingsSchema.test.ts` with a
    profiles case (valid kept, malformed dropped, name sanitized, cap enforced).
- **Apply (renderer)** — `api.setDefaultDevice(outputId)` then `api.setDefaultDevice(inputId)`.
  The existing handler routes by id role; offline/missing ids just log + re-sync (no throw).
- **`src/renderer/src/components/ProfilesRow.tsx`** (new, rendered on the main panel above
  the master-volume block)
  - A chip per profile: tap → apply; an `×` (hover) → delete.
  - A `+` button toggles a compact composer with two modes:
    - **Save current** — pre-fills the current default output + input ids from the live
      snapshot; user types a name → create.
    - **Build manually** — output `<select>` + input `<select>` (from the snapshot's online
      devices) + name → create.
  - IDs via `crypto.randomUUID()`. Create/delete go through
    `api.updateSettings({ profiles })`.
  - If a profile's saved device is offline at apply time, apply proceeds best-effort
    (matches `setDefaultDevice`'s existing behavior).
- **`App.tsx`** — render `ProfilesRow` with `profiles`, the current snapshot (for
  save-current + manual pickers), an `onApply(profile)`, and `onChange(profiles)` →
  `api.updateSettings({ profiles }).then(setSettings)`.

**Tests:** profiles coercion in `test/settingsSchema.test.ts`. UI is integration (untested).

## Out of scope
- Capturing volumes/mute in a profile (devices only, per decision).
- Per-profile hotkeys, reordering, import/export.
- New IPC channels (profiles ride existing `settings:update`).
