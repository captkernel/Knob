# Knob Display Phase B — Implementation Plan (drag-to-arrange editor)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive "Edit layout" mode to the Display tab — drag monitors on a canvas (edge-snapping), click a monitor for an on-canvas power/primary toolbar, then Apply / Save-as-profile / Cancel; edits both new arrangements and existing profiles.

**Architecture:** Renderer-only. Two pure, unit-tested helpers (`layoutScale` for scaled↔real coordinate mapping, `snapLayout` for edge-snap + overlap-normalize) feed a new `LayoutEditor` React component. Apply reuses the existing `api.applyDisplay(MonitorState[])`; Save reuses `updateSettings({ displayProfiles })`. No main-process, IPC, or data-model changes.

**Tech Stack:** React 18 (pointer events), TypeScript, Tailwind, lucide-react, Vitest. No new dependencies.

## Global Constraints

- **Renderer-only.** No changes to `src/shared`, `src/preload`, `src/main`. The renderer must NOT import main-process code (e.g. `src/main/display/displayPlan.ts`).
- **Topology only.** Editing changes only `x`, `y`, `enabled`, `primary` — never `width`/`height`/`refreshHz`/`device`/`id`.
- **Draft buffer.** Editing never touches real displays until **Apply**; Cancel discards. Seeds are deep-copied so the source (live snapshot or stored profile) is never mutated.
- **Invariants enforced structurally** (no `validateArrangement` import): always ≥1 enabled monitor (can't disable the last); exactly one primary among enabled (starring re-assigns; disabling the primary hands it to another enabled monitor).
- **Coordinate spaces:** `snapLayout` works in monitor coords (real px); the editor converts via `layoutScale` and passes the snap threshold in monitor px (`SNAP_PX / scale`).
- **Apply path unchanged:** `api.applyDisplay(draft)` — the existing main handler runs `planApply` (matches by stable `id`, re-resolves `\\.\DISPLAYn`, validates) and returns `ApplyResult`.

---

## File Structure

**Created:**
- `src/renderer/src/lib/layoutScale.ts` — pure scale/offset computation + monitor↔canvas mapping + scaled rects for rendering.
- `src/renderer/src/lib/snapLayout.ts` — pure `snapDrag` + `normalize`.
- `src/renderer/src/components/LayoutEditor.tsx` — the draft editor (drag, on-canvas toolbar, footer).
- `test/layoutScale.test.ts`, `test/snapLayout.test.ts` — unit tests.

**Modified:**
- `src/renderer/src/components/LayoutDiagram.tsx` — consume `layoutScale` (behaviour unchanged).
- `src/renderer/src/components/DisplayView.tsx` — "Edit layout" button + edit-mode state; route Apply/Save/Cancel; pass `onEdit` to the profiles row.
- `src/renderer/src/components/DisplayProfilesRow.tsx` — add a pencil "edit" button per chip + `onEdit` prop.

---

## Task 1: `layoutScale.ts` — shared coordinate math (+ refactor LayoutDiagram)

**Files:**
- Create: `src/renderer/src/lib/layoutScale.ts`
- Test: `test/layoutScale.test.ts`
- Modify: `src/renderer/src/components/LayoutDiagram.tsx`

**Interfaces:**
- Produces:
  - `interface LayoutScale { scale: number; offsetX: number; offsetY: number; minX: number; minY: number }`
  - `interface ScaledRect { m: MonitorState; sx: number; sy: number; sw: number; sh: number }`
  - `computeScale(monitors: MonitorState[], canvasW: number, canvasH: number, padding: number): LayoutScale | null`
  - `monitorToCanvas(x: number, y: number, s: LayoutScale): { cx: number; cy: number }`
  - `canvasToMonitor(cx: number, cy: number, s: LayoutScale): { x: number; y: number }`
  - `scaledRects(monitors: MonitorState[], s: LayoutScale): ScaledRect[]`

- [ ] **Step 1: Write the failing tests**

`test/layoutScale.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeScale, monitorToCanvas, canvasToMonitor, scaledRects } from '../src/renderer/src/lib/layoutScale'
import type { MonitorState } from '../src/shared/types'

const m = (id: string, o: Partial<MonitorState> = {}): MonitorState => ({
  id, device: `\\\\.\\${id}`, name: id, enabled: true, primary: false,
  x: 0, y: 0, width: 1920, height: 1080, ...o
})

describe('computeScale', () => {
  it('returns null when no enabled monitor has positive area', () => {
    expect(computeScale([], 280, 150, 8)).toBeNull()
    expect(computeScale([m('a', { enabled: false })], 280, 150, 8)).toBeNull()
    expect(computeScale([m('a', { width: 0, height: 0 })], 280, 150, 8)).toBeNull()
  })
  it('fits the enabled bounding box preserving aspect ratio', () => {
    // single 1920x1080 into 280x150 (padding 8 → avail 264x134): scale = min(264/1920,134/1080)=0.1240..
    const s = computeScale([m('a')], 280, 150, 8)!
    expect(s.scale).toBeCloseTo(Math.min(264 / 1920, 134 / 1080), 6)
    expect(s.minX).toBe(0)
    expect(s.minY).toBe(0)
  })
})

describe('monitor<->canvas round-trip', () => {
  it('canvasToMonitor inverts monitorToCanvas', () => {
    const s = computeScale([m('a'), m('b', { x: 1920 })], 280, 150, 8)!
    const { cx, cy } = monitorToCanvas(1920, 0, s)
    const back = canvasToMonitor(cx, cy, s)
    expect(back.x).toBeCloseTo(1920, 4)
    expect(back.y).toBeCloseTo(0, 4)
  })
})

describe('scaledRects', () => {
  it('maps each monitor to a rect with a 2px minimum size', () => {
    const s = computeScale([m('a')], 280, 150, 8)!
    const [r] = scaledRects([m('a')], s)
    expect(r.sw).toBeGreaterThanOrEqual(2)
    expect(r.sh).toBeGreaterThanOrEqual(2)
    expect(r.sx).toBeCloseTo(s.offsetX, 4)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/layoutScale.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `layoutScale.ts`**

`src/renderer/src/lib/layoutScale.ts`:
```ts
import type { MonitorState } from '@shared/types'

export interface LayoutScale {
  scale: number
  offsetX: number
  offsetY: number
  minX: number
  minY: number
}

export interface ScaledRect {
  m: MonitorState
  sx: number
  sy: number
  sw: number
  sh: number
}

/** Scale + offsets that fit the ENABLED monitors' bounding box into the canvas (minus
 *  padding), preserving aspect ratio and centering. null if no enabled monitor has area. */
export function computeScale(
  monitors: MonitorState[],
  canvasW: number,
  canvasH: number,
  padding: number
): LayoutScale | null {
  const enabled = monitors.filter((m) => m.enabled && m.width > 0 && m.height > 0)
  if (enabled.length === 0) return null
  const minX = Math.min(...enabled.map((m) => m.x))
  const minY = Math.min(...enabled.map((m) => m.y))
  const maxX = Math.max(...enabled.map((m) => m.x + m.width))
  const maxY = Math.max(...enabled.map((m) => m.y + m.height))
  const totalW = maxX - minX
  const totalH = maxY - minY
  if (totalW === 0 || totalH === 0) return null
  const availW = canvasW - padding * 2
  const availH = canvasH - padding * 2
  const scale = Math.min(availW / totalW, availH / totalH)
  const offsetX = padding + (availW - totalW * scale) / 2
  const offsetY = padding + (availH - totalH * scale) / 2
  return { scale, offsetX, offsetY, minX, minY }
}

/** Monitor coords (top-left) → canvas px (top-left). */
export function monitorToCanvas(x: number, y: number, s: LayoutScale): { cx: number; cy: number } {
  return { cx: s.offsetX + (x - s.minX) * s.scale, cy: s.offsetY + (y - s.minY) * s.scale }
}

/** Canvas px (top-left) → monitor coords. Inverse of monitorToCanvas. */
export function canvasToMonitor(cx: number, cy: number, s: LayoutScale): { x: number; y: number } {
  return { x: s.minX + (cx - s.offsetX) / s.scale, y: s.minY + (cy - s.offsetY) / s.scale }
}

/** Map every monitor into a scaled rect for rendering (2px minimum size). */
export function scaledRects(monitors: MonitorState[], s: LayoutScale): ScaledRect[] {
  return monitors.map((m) => {
    const { cx, cy } = monitorToCanvas(m.x, m.y, s)
    return { m, sx: cx, sy: cy, sw: Math.max(m.width * s.scale, 2), sh: Math.max(m.height * s.scale, 2) }
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/layoutScale.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor LayoutDiagram to use the shared helper**

In `src/renderer/src/components/LayoutDiagram.tsx`: delete the local `computeLayout` and `ScaledMonitor` interface; import `computeScale, scaledRects` from `../lib/layoutScale`. Replace the layout computation with:
```ts
const scale = monitors.length > 0 ? computeScale(monitors, CANVAS_W, CANVAS_H, PADDING) : null
const layout = scale ? scaledRects(monitors, scale) : null
```
Keep `CANVAS_W = 280`, `CANVAS_H = 150`, `PADDING = 8` and the entire JSX (the `.map(({ m, sx, sy, sw, sh }) => …)` body is unchanged — `ScaledRect` has the same `m/sx/sy/sw/sh` shape). The placeholder branch (`!layout`) is unchanged.

- [ ] **Step 6: Verify the diagram is behaviourally unchanged**

Run: `npm run typecheck && npm run build && npm run test`
Expected: PASS (the round-trip + scaledRects tests pin the math; build confirms the diagram still compiles with identical output shape).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/lib/layoutScale.ts test/layoutScale.test.ts src/renderer/src/components/LayoutDiagram.tsx
git commit -m "feat(display): extract shared layoutScale helper; reuse in LayoutDiagram"
```

---

## Task 2: `snapLayout.ts` — edge-snap + normalize (pure)

**Files:**
- Create: `src/renderer/src/lib/snapLayout.ts`
- Test: `test/snapLayout.test.ts`

**Interfaces:**
- Consumes: `MonitorState` from `@shared/types`.
- Produces:
  - `snapDrag(dragged: MonitorState, others: MonitorState[], proposed: { x: number; y: number }, threshold: number): { x: number; y: number }`
  - `normalize(monitors: MonitorState[]): MonitorState[]`

- [ ] **Step 1: Write the failing tests**

`test/snapLayout.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { snapDrag, normalize } from '../src/renderer/src/lib/snapLayout'
import type { MonitorState } from '../src/shared/types'

const m = (id: string, o: Partial<MonitorState> = {}): MonitorState => ({
  id, device: `\\\\.\\${id}`, name: id, enabled: true, primary: false,
  x: 0, y: 0, width: 1000, height: 1000, ...o
})

describe('snapDrag', () => {
  const anchor = m('anchor', { x: 0, y: 0, width: 1000, height: 1000 })
  it('snaps the dragged left edge to a neighbour right edge within threshold', () => {
    // proposed left at 990, anchor right at 1000 → within 50 → snaps x to 1000
    const r = snapDrag(m('drag'), [anchor], { x: 990, y: 0 }, 50)
    expect(r.x).toBe(1000)
  })
  it('leaves position unchanged when outside threshold', () => {
    const r = snapDrag(m('drag'), [anchor], { x: 900, y: 0 }, 50)
    expect(r.x).toBe(900)
  })
  it('snaps top edges together vertically within threshold', () => {
    const r = snapDrag(m('drag'), [anchor], { x: 1000, y: 8 }, 50)
    expect(r.y).toBe(0)
  })
  it('ignores disabled neighbours as snap targets', () => {
    const off = m('off', { x: 0, y: 0, enabled: false })
    const r = snapDrag(m('drag'), [off], { x: 990, y: 0 }, 50)
    expect(r.x).toBe(990)
  })
})

describe('normalize', () => {
  it('resolves an overlap by right-packing the later monitor', () => {
    const a = m('a', { x: 0, primary: true })
    const b = m('b', { x: 500 }) // overlaps a (a spans 0..1000)
    const out = normalize([a, b])
    const nb = out.find((x) => x.id === 'b')!
    expect(nb.x).toBe(1000) // pushed to a's right edge
  })
  it('anchors the primary at origin', () => {
    const a = m('a', { x: 1920, y: 100, primary: true })
    const b = m('b', { x: 2920, y: 100 })
    const out = normalize([a, b])
    expect(out.find((x) => x.id === 'a')!.x).toBe(0)
    expect(out.find((x) => x.id === 'a')!.y).toBe(0)
    expect(out.find((x) => x.id === 'b')!.x).toBe(1000)
  })
  it('excludes disabled monitors from packing but still translates them by the anchor', () => {
    const a = m('a', { x: 1000, primary: true })
    const off = m('off', { x: 1000, enabled: false }) // same x as a, but disabled
    const out = normalize([a, off])
    expect(out.find((x) => x.id === 'a')!.x).toBe(0)
    // disabled not packed (not pushed right), only translated by -1000
    expect(out.find((x) => x.id === 'off')!.x).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/snapLayout.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `snapLayout.ts`**

`src/renderer/src/lib/snapLayout.ts`:
```ts
import type { MonitorState } from '@shared/types'

function rectsOverlap(a: MonitorState, b: MonitorState): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Snap the dragged monitor's edges to nearby ENABLED neighbours within `threshold`
 *  (monitor px). Returns the adjusted top-left. Pure; monitor coordinates. */
export function snapDrag(
  dragged: MonitorState,
  others: MonitorState[],
  proposed: { x: number; y: number },
  threshold: number
): { x: number; y: number } {
  const w = dragged.width
  const h = dragged.height
  let x = proposed.x
  let y = proposed.y
  const targets = others.filter((o) => o.enabled && o.id !== dragged.id)

  // X: align my left/right edges to their left/right edges. Pick the smallest shift.
  let bestDx = threshold
  for (const o of targets) {
    const candidates = [o.x + o.width - x, o.x - x, o.x - (x + w), o.x + o.width - (x + w)]
    for (const d of candidates) if (Math.abs(d) < Math.abs(bestDx)) bestDx = d
  }
  if (Math.abs(bestDx) < threshold) x += bestDx

  // Y: align top/bottom/center.
  let bestDy = threshold
  for (const o of targets) {
    const candidates = [
      o.y - y,
      o.y + o.height - (y + h),
      o.y + o.height - y,
      o.y - (y + h),
      o.y + o.height / 2 - (y + h / 2)
    ]
    for (const d of candidates) if (Math.abs(d) < Math.abs(bestDy)) bestDy = d
  }
  if (Math.abs(bestDy) < threshold) y += bestDy

  return { x, y }
}

/** Resolve overlaps among ENABLED monitors (deterministic left-to-right pack), then anchor
 *  the primary at origin. Disabled monitors are excluded from packing but translated by the
 *  anchor. Returns a new array; inputs are not mutated. */
export function normalize(monitors: MonitorState[]): MonitorState[] {
  const out = monitors.map((m) => ({ ...m }))
  const enabled = out.filter((m) => m.enabled)

  const placed: MonitorState[] = []
  for (const m of [...enabled].sort((a, b) => a.x - b.x || a.y - b.y)) {
    let pushTo = m.x
    for (const p of placed) if (rectsOverlap(m, p)) pushTo = Math.max(pushTo, p.x + p.width)
    m.x = pushTo
    placed.push(m)
  }

  const primary = out.find((m) => m.primary && m.enabled) ?? enabled[0]
  if (primary) {
    const dx = primary.x
    const dy = primary.y
    for (const m of out) {
      m.x -= dx
      m.y -= dy
    }
  }
  return out
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/snapLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/snapLayout.ts test/snapLayout.test.ts
git commit -m "feat(display): pure snapLayout (edge-snap + overlap-normalize)"
```

---

## Task 3: `LayoutEditor.tsx` — the draft editor

**Files:**
- Create: `src/renderer/src/components/LayoutEditor.tsx`

**Interfaces:**
- Consumes: `computeScale`, `scaledRects` (Task 1); `snapDrag`, `normalize` (Task 2); `MonitorState`.
- Produces:
  - `interface LayoutEditorProps { seed: MonitorState[]; initialName?: string; onApply: (monitors: MonitorState[]) => void; onSave: (monitors: MonitorState[], name: string) => void; onCancel: () => void }`
  - `export function LayoutEditor(props: LayoutEditorProps): JSX.Element`

- [ ] **Step 1: Implement the component**

`src/renderer/src/components/LayoutEditor.tsx`:
```tsx
import { useRef, useState } from 'react'
import { Power, Star, Check, X } from 'lucide-react'
import type { MonitorState } from '@shared/types'
import { computeScale, scaledRects } from '../lib/layoutScale'
import { snapDrag, normalize } from '../lib/snapLayout'

const CANVAS_W = 340
const CANVAS_H = 190
const PADDING = 12
const SNAP_PX = 10 // snap feel in canvas px (converted to monitor px via scale)

export interface LayoutEditorProps {
  seed: MonitorState[]
  initialName?: string
  onApply: (monitors: MonitorState[]) => void
  onSave: (monitors: MonitorState[], name: string) => void
  onCancel: () => void
}

export function LayoutEditor({ seed, initialName, onApply, onSave, onCancel }: LayoutEditorProps): JSX.Element {
  const [draft, setDraft] = useState<MonitorState[]>(() => seed.map((m) => ({ ...m })))
  const [name, setName] = useState(initialName ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; monX: number; monY: number } | null>(null)

  const scale = computeScale(draft, CANVAS_W, CANVAS_H, PADDING)
  const rects = scale ? scaledRects(draft, scale) : []
  const enabledCount = draft.filter((m) => m.enabled).length
  const validArrangement =
    enabledCount > 0 && draft.filter((m) => m.enabled && m.primary).length === 1

  const togglePower = (m: MonitorState): void => {
    if (m.enabled && enabledCount <= 1) return // never disable the last enabled
    setDraft((d) => {
      let next = d.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x))
      // Disabling the primary hands primary to another enabled monitor.
      if (m.enabled && m.primary) {
        const heir = next.find((x) => x.enabled && x.id !== m.id)
        if (heir) next = next.map((x) => ({ ...x, primary: x.id === heir.id }))
      }
      return normalize(next)
    })
  }

  const setPrimary = (m: MonitorState): void => {
    if (!m.enabled) return
    setDraft((d) => normalize(d.map((x) => ({ ...x, primary: x.id === m.id }))))
  }

  const onPointerDown = (e: React.PointerEvent, m: MonitorState): void => {
    setSelectedId(m.id)
    if (!scale) return
    dragRef.current = { id: m.id, startX: e.clientX, startY: e.clientY, monX: m.x, monY: m.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag || !scale) return
    const dxMon = (e.clientX - drag.startX) / scale.scale
    const dyMon = (e.clientY - drag.startY) / scale.scale
    const dragged = draft.find((x) => x.id === drag.id)
    if (!dragged) return
    const proposed = { x: drag.monX + dxMon, y: drag.monY + dyMon }
    const snapped = snapDrag(dragged, draft, proposed, SNAP_PX / scale.scale)
    setDraft((d) => d.map((x) => (x.id === drag.id ? { ...x, x: snapped.x, y: snapped.y } : x)))
  }
  const onPointerUp = (): void => {
    if (!dragRef.current) return
    dragRef.current = null
    setDraft((d) => normalize(d))
  }

  return (
    <div className="no-drag flex flex-col gap-3 px-5 pb-5 pt-2">
      <div className="text-xs font-medium uppercase tracking-wider text-white/45">Edit layout</div>

      {/* Canvas */}
      <div
        className="relative rounded-2xl border border-white/10 bg-white/5"
        style={{ width: CANVAS_W, height: CANVAS_H }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {rects.map(({ m, sx, sy, sw, sh }) => {
          const disabled = !m.enabled
          const selected = m.id === selectedId
          return (
            <div
              key={m.id}
              onPointerDown={(e) => onPointerDown(e, m)}
              className={`absolute flex cursor-grab flex-col items-center justify-center overflow-visible rounded-xl border text-center transition-colors ${
                disabled ? 'border-dashed border-white/20 bg-white/[0.02] opacity-50' : 'border-white/25 bg-white/[0.10]'
              } ${selected ? 'outline outline-2 outline-accent' : ''}`}
              style={{ left: sx, top: sy, width: sw, height: sh, touchAction: 'none' }}
            >
              {m.primary && (
                <Star size={10} className="absolute right-1 top-1 text-accent" fill="rgb(var(--accent))" stroke="rgb(var(--accent))" />
              )}
              {sw >= 36 && sh >= 22 && (
                <span className="px-1 text-[8px] font-medium leading-tight text-white/75">{m.name}</span>
              )}

              {/* On-canvas toolbar for the selected monitor */}
              {selected && (
                <div
                  className="absolute -top-7 left-1/2 flex -translate-x-1/2 gap-1 rounded-lg border border-white/15 bg-neutral-900/95 px-1.5 py-1"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => togglePower(m)}
                    disabled={m.enabled && enabledCount <= 1}
                    title={m.enabled ? 'Disable' : 'Enable'}
                    className={`grid h-5 w-5 place-items-center rounded ${
                      m.enabled ? 'text-white/80 hover:bg-white/10' : 'text-white/40 hover:bg-white/10'
                    } disabled:cursor-not-allowed disabled:opacity-30`}
                  >
                    <Power size={12} />
                  </button>
                  <button
                    onClick={() => setPrimary(m)}
                    disabled={!m.enabled}
                    title="Make primary"
                    className={`grid h-5 w-5 place-items-center rounded hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 ${
                      m.primary ? 'text-accent' : 'text-white/60'
                    }`}
                  >
                    <Star size={12} fill={m.primary ? 'rgb(var(--accent))' : 'none'} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer: name + actions */}
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Profile name"
          maxLength={64}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-accent/60"
        />
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10"
        >
          <X size={13} /> Cancel
        </button>
        <button
          onClick={() => onSave(draft, name.trim())}
          disabled={!name.trim() || !validArrangement}
          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check size={13} /> Save
        </button>
        <button
          onClick={() => onApply(draft)}
          disabled={!validArrangement}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build`
Expected: PASS (renderer bundles). No unit tests — the editor is exercised in the Task 5 manual smoke.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/LayoutEditor.tsx
git commit -m "feat(display): LayoutEditor — drag, on-canvas power/primary, save/apply"
```

---

## Task 4: Wire the editor into DisplayView + add the chip edit affordance

**Files:**
- Modify: `src/renderer/src/components/DisplayView.tsx`
- Modify: `src/renderer/src/components/DisplayProfilesRow.tsx`

**Interfaces:**
- Consumes: `LayoutEditor` + `LayoutEditorProps` (Task 3); existing `api.applyDisplay`, `onUpdateSettings`.
- Produces: `DisplayProfilesRow` gains `onEdit: (p: DisplayProfile) => void`.

- [ ] **Step 1: Add the chip edit button to DisplayProfilesRow**

In `src/renderer/src/components/DisplayProfilesRow.tsx`:
- Add `onEdit: (p: DisplayProfile) => void` to `Props` (with a doc comment).
- Import `Pencil` from `lucide-react` (alongside `Plus, X, Check`).
- In each chip, insert an edit button BETWEEN the apply button and the delete (`X`) button:
```tsx
<button
  onClick={() => onEdit(p)}
  className="grid h-6 w-6 place-items-center rounded-full text-white/30 transition-colors hover:bg-white/10 hover:text-white/70"
  title="Edit layout"
>
  <Pencil size={11} />
</button>
```
Leave the rest of the component (Save-current composer) unchanged.

- [ ] **Step 2: Add edit-mode state + the editor to DisplayView**

In `src/renderer/src/components/DisplayView.tsx`:
- Import `LayoutEditor` from `./LayoutEditor`, and `Pencil`/`SlidersHorizontal` is not needed; import nothing else new beyond `LayoutEditor` and `MonitorState` (already importing types — add `MonitorState`).
- Add state: `const [editing, setEditing] = useState<{ seed: MonitorState[]; profileId: string | null; name: string } | null>(null)`.
- Add an **"Edit layout"** button just under the `LayoutDiagram` (only when NOT editing), seeded from the live snapshot:
```tsx
{!editing && (
  <button
    onClick={() =>
      setEditing({ seed: (snap?.monitors ?? []).map((m) => ({ ...m })), profileId: null, name: '' })
    }
    disabled={!snap || snap.monitors.length === 0}
    className="no-drag self-start rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
  >
    Edit layout
  </button>
)}
```
- Define the editor handlers:
```tsx
const saveEdited = (monitors: MonitorState[], name: string): void => {
  const trimmed = name.trim().slice(0, 64) || 'Profile'
  const copy = monitors.map((m) => ({ ...m }))
  const list = editing?.profileId
    ? settings.displayProfiles.map((p) => (p.id === editing.profileId ? { ...p, name: trimmed, monitors: copy } : p))
    : [...settings.displayProfiles, { id: crypto.randomUUID(), name: trimmed, monitors: copy }]
  onUpdateSettings({ displayProfiles: list })
  setEditing(null)
}
const applyEdited = (monitors: MonitorState[]): void => {
  api
    .applyDisplay(monitors)
    .then((res: ApplyResult) => {
      if (res.error) setApplyNote(res.error)
      else if (res.missingIds.length > 0) setApplyNote(`${res.missingIds.length} display(s) in this profile aren't connected`)
      else setApplyNote(null)
    })
    .catch((e) => {
      console.error('[display]', e)
      setApplyNote('Failed to apply display layout')
    })
}
```
- Render the editor in place of the read-only diagram + profiles row when `editing` is set:
```tsx
{editing ? (
  <LayoutEditor
    seed={editing.seed}
    initialName={editing.name}
    onApply={applyEdited}
    onSave={saveEdited}
    onCancel={() => setEditing(null)}
  />
) : (
  <>
    <LayoutDiagram monitors={snap?.monitors ?? []} />
    {/* Edit layout button (from above) */}
    <DisplayProfilesRow
      profiles={settings.displayProfiles}
      monitors={snap?.monitors ?? []}
      onApply={apply}
      onChange={(next) => onUpdateSettings({ displayProfiles: next })}
      onEdit={(p) => setEditing({ seed: p.monitors.map((m) => ({ ...m })), profileId: p.id, name: p.name })}
    />
  </>
)}
```
(Integrate this with the existing helper banner and apply-note JSX — the banner stays visible above; the apply note stays below.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build && npm run test`
Expected: PASS (all existing tests stay green; the two new pure modules add their tests).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/DisplayView.tsx src/renderer/src/components/DisplayProfilesRow.tsx
git commit -m "feat(display): wire LayoutEditor into DisplayView; add chip edit affordance"
```

---

## Task 5: Verification + build + manual smoke

**Files:** none (verification).

- [ ] **Step 1: Full check**

Run: `npm run check`
Expected: PASS — typecheck + all unit tests (incl. new `layoutScale` + `snapLayout`) + build.

- [ ] **Step 2: Build the standalone exe**

Per project memory, a prior running instance locks the build. First: `Stop-Process -Name "SoundDeck" -Force` (PowerShell), confirm none remain, then `npm run dist:standalone`. Do NOT launch unless asked.

- [ ] **Step 3: Manual smoke (with the user, on the real rig)**

Open the Display tab → **Edit layout**:
- Drag a monitor — confirm it **snaps** flush to its neighbour (no gap/overlap).
- Select a monitor → toolbar: **power** toggles it dim/active (can't disable the last one); **star** moves the primary.
- **Apply** — the real displays rearrange to match; revert is available in Windows Settings.
- **Save** with a name → a chip appears; the **pencil** on a chip reopens that profile in the editor; tweak + Save updates it.
- **Cancel** discards with no display change.
- Confirm the Audio tab and the Phase A read-only diagram are unchanged.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch` to merge `feature/display-phase-b`.

---

## Self-Review

**Spec coverage:**
- §2 renderer-only architecture, no main/IPC/data changes → Tasks 1–4 touch only `src/renderer`. ✅
- §3 geometry engine (`snapDrag`, `normalize`) → Task 2. `layoutScale` (scale + inverse) → Task 1. ✅
- §4 draft state, drag→snap→normalize, toolbar power/star, Apply/Save/Cancel → Task 3 + Task 4. ✅
- §5 invariants enforced structurally (last-enabled, one-primary, disabled excluded) → Task 3 (`togglePower`/`setPrimary`/`validArrangement`) + Task 2 (`normalize`). ✅
- §6 tests (snapLayout, layoutScale) → Tasks 1, 2. ✅
- §7 untouched surfaces → confirmed by file list (no `src/shared`/`src/preload`/`src/main` edits). ✅
- Edit existing profiles (chip pencil) + edit new (Edit layout button) → Task 4. ✅

**Placeholder scan:** No TBD/TODO; all code steps contain complete implementations. ✅

**Type consistency:** `LayoutScale`/`ScaledRect`/`computeScale`/`monitorToCanvas`/`canvasToMonitor`/`scaledRects` (Task 1) used verbatim in Tasks 1 & 3; `snapDrag`/`normalize` (Task 2) used in Task 3; `LayoutEditorProps` (Task 3) matches the props passed in Task 4; `onEdit` added to `DisplayProfilesRow` in Task 4 step 1 and passed in step 2. ✅

**Known limitation (documented):** `normalize` v1 resolves horizontal overlaps and anchors the primary; it does not aggressively close gaps the user leaves (snapping covers flush placement). Acceptable for the horizontal-row setups in scope; revisit if vertical stacking becomes common.
