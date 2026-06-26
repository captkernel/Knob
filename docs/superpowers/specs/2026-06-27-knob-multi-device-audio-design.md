# Knob — Multi-device audio (VoiceMeeter-backed)

Date: 2026-06-27
Status: Approved (design) — BUILD DEFERRED (user: "build later"). Pick up at writing-plans (phase 1).
Related: extends the audio side of Knob (formerly SoundDeck). Sibling features: display Phase A/B (shipped).

## 0. Why this needs VoiceMeeter (the feasibility reality)

The user wants to **record from 2 mics at once** (podcast) and **play audio to 2 speakers at once**.
Windows has only ONE default output and ONE default input at a time, and nothing svcl can toggle
makes the system record from two mics or play to two speakers simultaneously — that capability
does not exist at the "set a default device" layer. Verified on the user's machine: **no Stereo
Mix / loopback device exists**, so even the one native dual-output trick ("Listen to this device"
of captured system audio) is unavailable.

Therefore true simultaneous multi-device requires a **virtual audio mixer driver**. The chosen
approach (user-approved) is **VoiceMeeter** (free, VB-Audio). Knob becomes a VoiceMeeter
controller. Target edition: **VoiceMeeter Banana** (plain VoiceMeeter drives only one hardware
output, so it can't do 2 speakers; Banana does both 2-speaker out and mic-merge).

## 1. Scope

- **"Play to 2 speakers" (multiOutput):** all system audio plays on two chosen output devices at once.
- **"Record 2 mics" (multiMic), mixed track (v1):** two chosen mics merged into one virtual recording
  device; recording apps capture both voices as a single combined track.
- Saved, named **multi-device setups** (like profiles) applied in one tap.

Out of scope (v1): separate-per-mic recording tracks (needs app-side multi-channel ASIO — REAPER/OBS,
not automatable by routing alone); per-strip gain/mixing UI; non-VoiceMeeter mixers.

## 2. Architecture — how Knob controls VoiceMeeter

**Approach (approved): PowerShell bridge, NOT a Node FFI dependency.** A small `.ps1` P/Invokes
`VoicemeeterRemote64.dll` (`VBVMR_Login` / `VBVMR_SetParameterFloat` / `VBVMR_SetParameterStringA` /
`VBVMR_GetVoicemeeterType` / `VBVMR_RunVoicemeeter` / `VBVMR_Logout`), invoked via `execFile` —
exactly how Knob already shells out to svcl, MultiMonitorTool, and `winAppOverride`. No new npm
dependency, no Electron native-module packaging. Per-call spawn overhead is irrelevant (routing only
changes on profile-apply). (`koffi` Node FFI was the considered alternative; rejected to keep the
project native-dep-free.)

Integration layer (mirrors the svcl/MMT helper pattern):
- **`voicemeeterBridge`** — discovers the DLL via the registry (`HKLM\SOFTWARE\WOW6432Node\VB-Audio\
  Voicemeeter` install folder; the Remote DLL sits in that folder). Reports state:
  `not-installed` | `installed-not-running` | `ready`, plus edition (VoiceMeeter/Banana/Potato via
  `VBVMR_GetVoicemeeterType`). Can launch VoiceMeeter (`VBVMR_RunVoicemeeter`) if installed but not running.
- **`VoiceMeeterService`** — thin typed wrapper: `getStatus()`, `apply(routing)` where `routing` is a
  small set of parameter assignments. All `VBVMR_SetParameter*` calls live in the bridge `.ps1`.
- **"VoiceMeeter not installed" UI state** (like the svcl download banner) linking to the VB-Audio
  download — Knob can't silently install it, so it guides the user.

## 3. The two setups — routing mechanics + what Knob applies automatically

Both work by making a VoiceMeeter virtual device the Windows default, then routing inside VoiceMeeter.
On Apply, Knob launches VoiceMeeter if needed, then does ALL of:

**multiOutput ("play to 2 speakers"):**
- Bind bus **A1 → Speaker 1**, **A2 → Speaker 2** (`Bus[0].device.wdm` / `Bus[1].device.wdm`).
- Route the **virtual input strip** → A1 + A2 (`Strip[N].A1=1`, `Strip[N].A2=1`, N = the VAIO virtual input).
- Set Windows **default output = "VoiceMeeter Input"** (virtual playback device) via svcl.
- Apps → Windows default (VoiceMeeter) → fan out to both speakers. ✓

**multiMic ("record 2 mics", mixed):**
- Bind input **Strip[0].device → Mic 1**, **Strip[1].device → Mic 2**.
- Route both strips → bus **B1** (`Strip[0].B1=1`, `Strip[1].B1=1`). B1 = "VoiceMeeter Output" virtual
  recording device.
- Set Windows **default input = "VoiceMeeter Output"** via svcl.
- Default-mic recording apps capture both mics mixed into one track. ✓

Knob fully applies each setup: VoiceMeeter routing (bridge) **+** the Windows default switch (existing
svcl service). User picks 2 speakers / 2 mics from the device list they already see.

**Primary technical risk (call out in the plan):** VoiceMeeter binds physical devices **by name
string**, and its expected format may not match svcl's friendly name verbatim. A **device-name
resolution step** (map the user's chosen svcl device → the exact name VoiceMeeter wants; possibly
enumerate VoiceMeeter's own device list via `VBVMR_Input/Output_GetDeviceDesc`) is the part most likely
to need iteration. Validate on real hardware at the phase-1 checkpoint.

**Caveats v1 documents:** (1) Applying a setup OVERWRITES VoiceMeeter's current routing — invasive for
users with their own VoiceMeeter config. (2) VoiceMeeter must stay running (it is the audio engine now).

## 4. Data model

New `Settings.multiSetups: MultiSetup[]`, coerced/capped like `profiles`/`displayProfiles`:
```ts
interface MultiSetup {
  id: string
  name: string
  kind: 'multiOutput' | 'multiMic'
  deviceIds: string[]   // the 2+ svcl device ids chosen (outputs for multiOutput, inputs for multiMic)
}
```
Store INTENT (kind + chosen devices), not raw VoiceMeeter params; routing is computed at apply time.
Persisted through the existing `settings:update`.

## 5. The pure, testable core

`buildRouting(setup: MultiSetup, edition: VmEdition) → { vmParams: { name: string; value: number | string }[];
defaultDevice: { id: string; role: 'output' | 'input' } }` — given a setup, produce the exact VoiceMeeter
parameter list AND which Windows default svcl should set. Pure, unit-tested (the bridge `.ps1` and
registry/DLL discovery are integration glue, validated in smoke like `svclInstaller`).

## 6. IPC

New channels (renderer→main): `vm:getStatus`, `vm:applyMultiSetup` (setupId | MultiSetup), `vm:launch`,
`vm:restoreDirect` (set default back to a chosen physical device). Main→renderer: `vm:statusChanged`.
Multi-setups persist via the existing `settings:update`. `ApplyResult`-style return with structured
errors (offending device / edition-too-low / bridge failure). No handler throws past the IPC boundary.

## 7. UI

A **"Multi-device" section inside the Audio view** (user-approved over a third tab): a VoiceMeeter
status line ("connected — Banana" / "not installed" / "not running"), saved-setup chips (tap to apply,
like profiles), and a composer (pick kind → multi-select 2+ devices → name → save). When VoiceMeeter
isn't installed, the section shows guided install (download link) instead of the composer. Plus a small
**"Restore direct audio"** action that sets the default back to a single physical device (the way out of
VoiceMeeter). Basic-edition + multiOutput shows a clear warning (needs Banana/Potato).

## 8. Edge handling

- not-installed → guided install; setups disabled.
- installed-not-running → Apply launches VoiceMeeter (`VBVMR_RunVoicemeeter`) and waits for ready.
- basic edition + multiOutput → clear warning (2-speaker needs Banana/Potato; mic-merge works any edition).
- bridge/param failure or unbindable device name → structured error naming the device; never crash.
- VoiceMeeter must stay running — if it's killed, the setup stops working (documented).

## 9. Testing

- **`buildRouting` unit tests:** multiOutput (2 devices) → Bus[0]/Bus[1] device binds + virtual-strip
  A1/A2 routes + default-output target; multiMic → strip device binds + B1 routes + default-input target;
  edition gating.
- **`coerceSettings` tests:** malformed `MultiSetup[]` dropped/sanitized; cap; kind validated; deviceIds
  filtered to strings; require ≥2 deviceIds (or drop).
- Bridge `.ps1`, registry/DLL discovery, launch — integration glue, validated in the phase-1 smoke.

## 10. Build sequencing — TWO sequenced plans (the bridge is the risk)

1. **Foundation:** PowerShell bridge (.ps1 P/Invoke) + DLL discovery via registry + `VoiceMeeterService`
   + status/launch/edition detection + IPC + a visible "VoiceMeeter: connected (Banana)" status.
   **HARD CHECKPOINT:** prove a single end-to-end routing change works on real hardware (VoiceMeeter
   installed) — this is where the device-name-binding risk surfaces — BEFORE building feature UI.
2. **Setups:** `MultiSetup` data model + `buildRouting` (pure, tested) + apply (bridge routing + svcl
   default) + the Multi-device UI section + composer + both modes + restore-direct.

One spec (this doc) captures the whole vision; execute as those two plans so UI isn't polished on top of
an unproven bridge.

## Key approved decisions (quick reference)

- Backend: **VoiceMeeter**, target **Banana**. PowerShell bridge (no Node FFI dep).
- Recording v1: **single mixed track** (separate tracks deferred).
- UI: **section inside the Audio view** (not a third tab).
- Build: **deferred** by the user on 2026-06-27; resume at phase-1 plan.
