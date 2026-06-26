# Knob Display — Phase B: visual drag-to-arrange editor

Date: 2026-06-26
Status: Approved (design)
Builds on: `2026-06-26-knob-display-control-design.md` (Phase A, shipped to main)

## 1. Scope

A draft **"Edit layout"** mode inside the Display tab: a larger canvas where the user
**drags monitors** (with edge-snapping) and **clicks a monitor for an on-canvas toolbar**
(power = enable/disable, star = set primary). Footer actions:

- **Apply** — push the draft arrangement to the real displays now.
- **Save as profile** — store the draft as a chip (prompts for a name when new; updates
  the same profile when editing an existing one). Does not require applying.
- **Cancel** — discard the draft; displays untouched.

Reachable two ways:
- "Edit layout" seeds a draft from the **current** arrangement (build new).
- Each saved profile chip gets an **edit affordance** that opens **that profile** in the
  same editor (tweak + re-save).

The edit model is a **draft buffer** (chosen over live-apply): editing never changes real
displays until Apply, which lets the user author arrangements they are not currently in
(e.g. "laptop off, small right / big left" while all three are on).

Out of scope: any backend/IPC/data-model change (see §2); changing resolution/refresh
(topology only, inherited from Phase A); a live-preview-while-dragging mode.

## 2. Architecture — renderer-only

Phase A already did the backend work, and the wiring already supports B:
- **`api.applyDisplay` already accepts a `MonitorState[]`** (not just a profile id), and the
  main handler runs it through `planApply`, which takes an arbitrary arrangement, matches by
  stable `id`, and re-resolves `\\.\DISPLAYn` at apply time.
- `DisplayProfile` already stores `MonitorState[]`; saving is the existing
  `updateSettings({ displayProfiles })`.

Therefore **Phase B is entirely new renderer code** — no changes to `shared/types`, preload,
`ipc.ts`, the MMT backend, or the data model.

New / changed renderer units (each focused and independently testable):

- **`src/main/.../` — none.** (No main-process changes.)
- **`src/renderer/src/lib/layoutScale.ts` (pure)** — extract the existing `computeLayout`
  scaling math out of `LayoutDiagram` so the read-only diagram and the editor share it; add
  the inverse mapping (screen-px → monitor-coords) used while dragging.
- **`src/renderer/src/lib/snapLayout.ts` (pure, unit-tested)** — the geometry engine:
  `snapDrag` (edge-snap a dragged monitor to its neighbours) and `normalize` (remove
  gaps/overlaps among enabled monitors, anchor primary at origin).
- **`src/renderer/src/components/LayoutEditor.tsx`** — the draft editor: owns the working
  `MonitorState[]`, handles drag via the scale + snap helpers, renders the on-canvas toolbar
  and the footer actions.
- **`src/renderer/src/components/LayoutDiagram.tsx` (small change)** — consume the extracted
  `layoutScale` (behaviour unchanged; read-only).
- **`src/renderer/src/components/DisplayView.tsx` (small change)** — an "Edit layout" button
  toggles editor mode; passes the seed arrangement (current snapshot, or a profile to edit);
  routes Apply / Save / Cancel.
- **`src/renderer/src/components/DisplayProfilesRow.tsx` (small change)** — add an edit
  affordance to each chip that opens that profile in the editor; the existing "Build manually"
  placeholder becomes this entry point.

## 3. Geometry engine (`snapLayout.ts`, pure)

Two pure functions, unit-tested on plain numbers (no React/DOM):

- **`snapDrag(dragged, others, proposedXY, threshold) → { x, y }`** — while dragging, snap the
  moving monitor's edges to nearby monitors' edges within `threshold`: left↔right edges align
  horizontally; top / bottom / vertical-center align vertically. Returns the snapped top-left.
  Both functions operate in **monitor coordinates (real px)**; the editor does the scaled↔real
  conversion via `layoutScale` and passes `threshold` in monitor px (the ~12 scaled-px feel
  divided by the current scale). Keeping snapLayout in one coordinate space avoids mixed-space
  bugs.
- **`normalize(monitors) → MonitorState[]`** — after a drop (or a toggle), among the
  **enabled** monitors eliminate gaps and overlaps so the arrangement is contiguous (no
  desktop dead zones), then translate the whole set so the **primary** sits at origin
  `(0,0)` (matching how Windows anchors coordinates). Disabled monitors are excluded from
  packing and keep their stored `x/y`.

Keeping snap/pack math pure and separate from React is the central design choice: it is
painful to debug through the DOM but trivial to test as `in → out`.

## 4. Draft state & data flow

- `LayoutEditor` owns a local `draft: MonitorState[]`, seeded on open from either the live
  snapshot or the profile being edited, **deep-copied** so editing never mutates the source.
- **Drag:** pointer move → `layoutScale` inverse maps screen→coords → `snapDrag` → update
  that monitor's `x/y` in draft → on drop, `normalize(draft)`.
- **Toolbar power:** toggles `enabled`; disabling re-`normalize`s the remaining enabled set.
- **Toolbar star:** sets `primary` true on the clicked monitor, false on all others.
- **Apply:** `api.applyDisplay(draft)` → reuse Phase A's `ApplyResult` note handling
  (missing ids / error).
- **Save as profile:** new → prompt name → `onChange([...profiles, { id: crypto.randomUUID(),
  name, monitors: draft.map(copy) }])`; editing existing → replace that profile's `monitors`
  (and name if changed). Routed through the existing `updateSettings({ displayProfiles })`.
- **Cancel/close:** drop the draft; return to the read-only view.

## 5. Validation & edge cases

- Reuse `validateArrangement` live: the editor **prevents** disabling the last enabled
  monitor (its power button is disabled) and always keeps **exactly one primary** (starring
  one un-stars the others), so a draft is always valid before Apply.
- Editing a profile that references a currently-**disconnected** monitor: the editor still
  shows it (from stored data) so it can be repositioned/kept; Apply skips it (existing
  `missingIds` note), Save keeps it.
- A disabled monitor keeps its stored `x/y` but is excluded from packing and shown
  dimmed/parked; `planApply` just disables it (no position command).
- The canvas grows in edit mode (the panel may be taller while editing) so dragging has
  room; the read-only diagram size is unchanged.
- DPI/scale: all editing happens in scaled space; only `x/y`, `enabled`, `primary` change —
  never resolution — so topology-only is preserved.

## 6. Testing

- **`snapLayout` unit tests:** snap to each edge within / outside threshold; overlap
  resolution; `normalize` produces gap-free, non-overlapping, origin-anchored output;
  disabled monitors excluded from packing.
- **`layoutScale` unit tests:** forward scale + inverse round-trip; empty / zero-area guard.
- The editor component is exercised in the manual smoke (drag, toggle, star, apply, save,
  edit-existing), like the other UI.

## 7. What stays untouched

No changes to `shared/types`, preload, `ipc.ts`, the MMT backend, or the data model. The
audio path and the Phase A read-only Display view are unaffected — the editor is an additive
mode.
