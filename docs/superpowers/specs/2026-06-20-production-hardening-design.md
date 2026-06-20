# SoundDeck — Production Hardening & Shareability (Tier 2 + Tier 3)

**Date:** 2026-06-20
**Goal:** Make SoundDeck a robust, shareable open-source Windows app (clean public
GitHub repo + releases that "just work"). Functionality and reliability first.

**Out of scope (this pass):** Tier 1 legal work (svcl.exe download-on-first-run),
code signing, auto-update, telemetry/Sentry, `sandbox:true`, e2e tests. These are
documented as known limitations / future work, not implemented here.

---

## 0. Lead bug — hotkey does not summon the panel

### Root cause
`globalShortcut.register()` can fail (the accelerator is already owned by another
app) and the failure is **silent and unrecoverable**: `index.ts` only does a
`console.warn` (invisible in a packaged build), there is no retry, no verification,
and nothing tells the user. The most likely trigger is a **startup race** — with
`launchOnStartup: true`, SoundDeck competes at login with other startup apps
(Realtek/NVIDIA audio utilities, screenshot tools) that grab `Ctrl+Alt+*` combos.
Evidence: the stored accelerator (`Control+Alt+A`) is valid and registers fine in a
fresh `npm run dev` run (no warning); the packaged app was running but the hotkey did
not summon it; the tray (left-click + menu) still works.

### Fix (no silent surprise-rebinding — that just moves the symptom)
1. **Verify** registration with `globalShortcut.isRegistered()` after `register()`.
2. **Retry the configured hotkey** with backoff (e.g. ~1s, 3s, 7s, 15s) to win the
   login race for transient conflicts.
3. **Surface status** so it is never invisible: a `HotkeyStatus` flows main→renderer;
   Settings shows an actionable banner when the hotkey is unregistered ("in use by
   another app — pick a different combo"); the tray tooltip reflects it.
4. The **tray stays a guaranteed fallback** to open the app (already true).

Backoff schedule extracted as a pure, unit-tested function.

## 1. Observability — file logger + global error handling
- `src/main/logger.ts`: append-structured logs to `userData/logs/main.log`, size-capped
  (rotate to `main.log.1`). `info/warn/error`. Pure formatter unit-tested.
- Route main-process `console.*` + `uncaughtException`/`unhandledRejection` through it;
  the process **stays alive** on uncaught errors (logs instead of dying silently).

## 2. Resilience hardening
- `SvclAudioService` write methods (`setDefaultDevice/Volume/Muted`) wrap `run()` so a
  failed svcl call never throws past the service (IPC already re-syncs).
- `window.ts`: guard `createWindow()` result in `showPanel()`; flush the move-debounce
  timer on quit so a late drag position is persisted.
- Renderer: a React **ErrorBoundary** wraps `App` (no more blank window on a render
  error); a **loading state** while the first snapshot is null.

## 3. Repo hygiene (shareability)
- `LICENSE` (MIT, Karan Parmar, 2026).
- `package.json`: `repository`, `bugs`, `homepage`, `keywords`, author email; bump to
  `1.0.0` once the above land.
- `.github/workflows/ci.yml`: windows-latest → `npm ci` → typecheck → test → build.
- `README.md`: hotkey-conflict troubleshooting, screenshots placeholder, contributing,
  CI badge; roadmap refresh.
- Security quick wins: tighten CSP (`default-src 'none'`); sanitize device aliases;
  `helpers/.gitkeep`.

## Verification
`npm run check` (typecheck + 42+ tests + build) green; new unit tests for logger,
backoff, alias sanitization pass; `npm run dev` confirms hotkey registers and status
is reported; manual confirmation that the hotkey summons the panel.
