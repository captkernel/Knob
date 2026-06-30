# Knob Multi-device Audio — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the VoiceMeeter integration *foundation* — a PowerShell bridge that talks to `VoicemeeterRemote64.dll`, registry-based discovery, a typed `VoiceMeeterService` (status/launch/setParams), IPC + preload wiring, and a visible "VoiceMeeter: …" status line in the Audio view — so that one end-to-end routing change can be proven on real hardware before any feature UI is built.

**Architecture:** Mirror the existing `src/main/display/` subsystem (MultiMonitorTool). A shipped `.ps1` P/Invokes the Remote DLL and emits one JSON line; `VoiceMeeterService` shells out to it via `execFile('powershell.exe', …)` exactly as `MmtDisplayService` shells out to MMT. A pure `parseVmStatus()` turns the JSON into a typed status (unit-tested). The DLL/script discovery and the routing-change smoke are integration glue, validated at the **hard checkpoint** once VoiceMeeter Banana is installed.

**Tech Stack:** TypeScript (strict, ESM), Electron (electron-vite), React 18 renderer, Vitest. PowerShell `.ps1` with `Add-Type` C# `DllImport` for the Remote DLL. **No new npm dependency.**

## Global Constraints

- **Native-dep-free:** no `koffi`/Node FFI/native module — VoiceMeeter is reached ONLY through the `.ps1` invoked with `execFile`. (Spec §2)
- **Mirror the svcl/MMT helper pattern** for discovery + service wrapper + IPC. (Spec §2)
- **No handler throws past the IPC boundary** — every `ipcMain.handle` catches, logs via `log`, and returns a safe value. (existing `src/main/ipc.ts` convention)
- **Target edition: VoiceMeeter Banana.** Plain VoiceMeeter (basic) can't drive 2 speakers; mic-merge works on any edition. (Spec §0, §8)
- **Status states (exact strings):** `'not-installed' | 'installed-not-running' | 'ready'`. (Spec §2)
- **Edition values (exact strings):** `'voicemeeter' | 'banana' | 'potato'`. Derived from `VBVMR_GetVoicemeeterType` (1/2/3).
- **ESM throughout** (`"type": "module"`); helper scripts are `.mjs`.
- **Pure cores are unit-tested with Vitest**, tests in `test/**/*.test.ts`, run with `npm run test`. Bridge `.ps1` + DLL discovery are integration glue, validated by the smoke script at the checkpoint.
- **Phase 1 does NOT build:** `MultiSetup` data model, `buildRouting`, the multi-device composer UI, or both routing modes — those are Phase 2 (separate plan). Phase 1 stops at a proven bridge + status line.

---

## File Structure

**New files:**
- `resources/voicemeeter-bridge.ps1` — the bridge. Subcommands `status` | `launch` | `set`. P/Invokes the Remote DLL via `Add-Type`. Emits one JSON line on stdout. Bundled into the app via `extraResources`.
- `src/main/voicemeeter/vmParse.ts` — pure: `parseVmStatus(raw) → VmStatus`, `editionFromType(n) → VmEdition | undefined`. Unit-tested.
- `src/main/voicemeeter/voicemeeterBridge.ts` — resolves the `.ps1` path (packaged vs dev), mirrors `resolveMmtPath`.
- `src/main/voicemeeter/VoiceMeeterService.ts` — typed wrapper: `getStatus()`, `launch()`, `setParams(params)`. Shells out to the `.ps1`.
- `src/main/voicemeeter/index.ts` — `createVoiceMeeterService()` factory (mock on non-win32 / missing script).
- `src/main/voicemeeter/MockVoiceMeeterService.ts` — returns `{ state: 'not-installed' }`; `setParams`/`launch` are no-ops.
- `scripts/vm-smoke.mjs` — standalone Node script that invokes the `.ps1` `set` subcommand to prove one routing change end-to-end. Used at the hard checkpoint.
- `test/vmParse.test.ts` — unit tests for the pure core.
- `src/renderer/src/components/VoiceMeeterStatus.tsx` — the status line UI inside the Audio view.

**Modified files:**
- `src/shared/types.ts` — add `VmEdition`, `VmStatus`, `VmSetParam`; add IPC channels `vm:getStatus`, `vm:launch`, `vm:statusChanged`.
- `src/main/voicemeeter/VoiceMeeterService.ts` (interface lives here, see Task 3).
- `src/main/ipc.ts` — register `vm:getStatus` / `vm:launch`; add `broadcastVmStatus`; accept the service param.
- `src/main/index.ts` — construct the service via the factory; pass it to `registerIpc`.
- `src/preload/index.ts` — expose `getVmStatus`, `launchVoicemeeter`, `onVmStatusChanged`.
- `src/renderer/src/components/AudioView.tsx` (or the Audio view root — confirm filename in Task 7) — render `<VoiceMeeterStatus />`.
- `electron-builder.yml` — confirm `resources/**/*` (incl. the `.ps1`) is in `extraResources` (it already globs `**/*`; verify in Task 2).
- `scripts/package-standalone.ps1` — ensure the `.ps1` is copied into the standalone bundle's resources.

---

## Task 1: Shared types & IPC channels

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces:
  - `type VmEdition = 'voicemeeter' | 'banana' | 'potato'`
  - `type VmState = 'not-installed' | 'installed-not-running' | 'ready'`
  - `interface VmStatus { state: VmState; edition?: VmEdition; version?: string }`
  - `interface VmSetParam { name: string; value: number | string }`
  - `IPC.vmGetStatus = 'vm:getStatus'`, `IPC.vmLaunch = 'vm:launch'`, `IPC.vmStatusChanged = 'vm:statusChanged'`

- [ ] **Step 1: Add the types**

In `src/shared/types.ts`, near the other domain types (after `ApplyResult`), add:

```typescript
export type VmEdition = 'voicemeeter' | 'banana' | 'potato'
export type VmState = 'not-installed' | 'installed-not-running' | 'ready'

export interface VmStatus {
  state: VmState
  /** present only when state === 'ready' (running) and the type is recognised */
  edition?: VmEdition
  /** dotted version, e.g. "2.0.6.8"; present when running */
  version?: string
}

/** One VoiceMeeter Remote parameter assignment. Numeric → SetParameterFloat, string → SetParameterStringA. */
export interface VmSetParam {
  name: string
  value: number | string
}
```

- [ ] **Step 2: Add the IPC channels**

In the `IPC` object in `src/shared/types.ts`, add to the `renderer -> main (invoke)` group:

```typescript
  vmGetStatus: 'vm:getStatus',
  vmLaunch: 'vm:launch',
```

and to the `main -> renderer (send)` group:

```typescript
  vmStatusChanged: 'vm:statusChanged',
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages yet; this only adds declarations)

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(vm): shared VoiceMeeter status types + IPC channels"
```

---

## Task 2: Pure status parser (`parseVmStatus`) — TDD

**Files:**
- Create: `src/main/voicemeeter/vmParse.ts`
- Test: `test/vmParse.test.ts`

**Interfaces:**
- Consumes: `VmStatus`, `VmEdition` from `src/shared/types.ts` (Task 1).
- Produces:
  - `editionFromType(n: number): VmEdition | undefined`
  - `parseVmStatus(raw: string): VmStatus` — never throws; malformed/empty input → `{ state: 'not-installed' }`.

The `.ps1` (Task 4) emits exactly one of these JSON shapes:
- DLL not found: `{"installed":false}`
- installed, app not running: `{"installed":true,"running":false}`
- installed & running: `{"installed":true,"running":true,"type":2,"version":"2.0.6.8"}`

- [ ] **Step 1: Write the failing tests**

Create `test/vmParse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseVmStatus, editionFromType } from '../src/main/voicemeeter/vmParse'

describe('editionFromType', () => {
  it('maps 1/2/3 to editions', () => {
    expect(editionFromType(1)).toBe('voicemeeter')
    expect(editionFromType(2)).toBe('banana')
    expect(editionFromType(3)).toBe('potato')
  })
  it('returns undefined for unknown types', () => {
    expect(editionFromType(0)).toBeUndefined()
    expect(editionFromType(99)).toBeUndefined()
  })
})

describe('parseVmStatus', () => {
  it('not installed when DLL missing', () => {
    expect(parseVmStatus('{"installed":false}')).toEqual({ state: 'not-installed' })
  })

  it('installed-not-running when present but app down', () => {
    expect(parseVmStatus('{"installed":true,"running":false}')).toEqual({
      state: 'installed-not-running'
    })
  })

  it('ready with edition + version when running', () => {
    expect(
      parseVmStatus('{"installed":true,"running":true,"type":2,"version":"2.0.6.8"}')
    ).toEqual({ state: 'ready', edition: 'banana', version: '2.0.6.8' })
  })

  it('ready without edition when type unrecognised', () => {
    const s = parseVmStatus('{"installed":true,"running":true,"type":42,"version":"9.9"}')
    expect(s.state).toBe('ready')
    expect(s.edition).toBeUndefined()
    expect(s.version).toBe('9.9')
  })

  it('treats malformed / empty / non-JSON as not-installed (never throws)', () => {
    expect(parseVmStatus('')).toEqual({ state: 'not-installed' })
    expect(parseVmStatus('not json')).toEqual({ state: 'not-installed' })
    expect(parseVmStatus('null')).toEqual({ state: 'not-installed' })
    expect(parseVmStatus('{"installed":true,"running":true}')).toMatchObject({ state: 'ready' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/vmParse.test.ts`
Expected: FAIL — "Cannot find module '../src/main/voicemeeter/vmParse'"

- [ ] **Step 3: Implement the parser**

Create `src/main/voicemeeter/vmParse.ts`:

```typescript
import type { VmEdition, VmStatus } from '../../shared/types'

/** VBVMR_GetVoicemeeterType: 1=Voicemeeter, 2=Banana, 3=Potato. */
export function editionFromType(n: number): VmEdition | undefined {
  switch (n) {
    case 1:
      return 'voicemeeter'
    case 2:
      return 'banana'
    case 3:
      return 'potato'
    default:
      return undefined
  }
}

/**
 * Parse the bridge .ps1's single-line JSON status into a typed VmStatus.
 * Never throws; any malformed input is treated as not-installed.
 */
export function parseVmStatus(raw: string): VmStatus {
  let o: unknown
  try {
    o = JSON.parse(raw)
  } catch {
    return { state: 'not-installed' }
  }
  if (!o || typeof o !== 'object') return { state: 'not-installed' }
  const r = o as Record<string, unknown>

  if (r.installed !== true) return { state: 'not-installed' }
  if (r.running !== true) return { state: 'installed-not-running' }

  const status: VmStatus = { state: 'ready' }
  if (typeof r.type === 'number') {
    const edition = editionFromType(r.type)
    if (edition) status.edition = edition
  }
  if (typeof r.version === 'string' && r.version) status.version = r.version
  return status
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/vmParse.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Confirm `extraResources` will bundle the .ps1 (read-only check)**

Read `electron-builder.yml`. Confirm the `extraResources` block copies `resources` with filter `'**/*'` (it does today). No edit needed if so; if the filter is narrower, add `- '**/*.ps1'`. Note the result in the commit body.

- [ ] **Step 6: Commit**

```bash
git add src/main/voicemeeter/vmParse.ts test/vmParse.test.ts
git commit -m "feat(vm): pure parseVmStatus + editionFromType (TDD)"
```

---

## Task 3: `VoiceMeeterService` interface + Mock

**Files:**
- Create: `src/main/voicemeeter/VoiceMeeterService.ts`
- Create: `src/main/voicemeeter/MockVoiceMeeterService.ts`

**Interfaces:**
- Consumes: `VmStatus`, `VmSetParam` from `src/shared/types.ts`.
- Produces:
  - `interface VoiceMeeterService { readonly isMock: boolean; getStatus(): Promise<VmStatus>; launch(): Promise<VmStatus>; setParams(params: VmSetParam[]): Promise<{ ok: boolean; error?: string }>; dispose?(): void }`
  - `class MockVoiceMeeterService implements VoiceMeeterService`

- [ ] **Step 1: Define the interface**

Create `src/main/voicemeeter/VoiceMeeterService.ts`:

```typescript
import type { VmSetParam, VmStatus } from '../../shared/types'

export interface VmApplyResult {
  ok: boolean
  error?: string
}

export interface VoiceMeeterService {
  readonly isMock: boolean
  /** Discover + report current status. Never throws. */
  getStatus(): Promise<VmStatus>
  /** Launch VoiceMeeter if installed-not-running; resolves with the post-launch status. */
  launch(): Promise<VmStatus>
  /** Apply a set of Remote parameter assignments (foundation: used by the smoke checkpoint). */
  setParams(params: VmSetParam[]): Promise<VmApplyResult>
  dispose?(): void
}
```

- [ ] **Step 2: Implement the mock**

Create `src/main/voicemeeter/MockVoiceMeeterService.ts`:

```typescript
import type { VmSetParam, VmStatus } from '../../shared/types'
import type { VmApplyResult, VoiceMeeterService } from './VoiceMeeterService'

/** Used on non-win32, or when the bridge script can't be located. */
export class MockVoiceMeeterService implements VoiceMeeterService {
  readonly isMock = true
  async getStatus(): Promise<VmStatus> {
    return { state: 'not-installed' }
  }
  async launch(): Promise<VmStatus> {
    return { state: 'not-installed' }
  }
  async setParams(_params: VmSetParam[]): Promise<VmApplyResult> {
    return { ok: false, error: 'VoiceMeeter not available (mock).' }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/voicemeeter/VoiceMeeterService.ts src/main/voicemeeter/MockVoiceMeeterService.ts
git commit -m "feat(vm): VoiceMeeterService interface + mock"
```

---

## Task 4: The PowerShell bridge script (`voicemeeter-bridge.ps1`)

**Files:**
- Create: `resources/voicemeeter-bridge.ps1`

**Interfaces:**
- Produces (CLI contract consumed by `VoiceMeeterService` in Task 5):
  - `powershell -File voicemeeter-bridge.ps1 status` → one JSON line (shapes per Task 2).
  - `powershell -File voicemeeter-bridge.ps1 launch` → one JSON line (post-launch status).
  - `powershell -File voicemeeter-bridge.ps1 set "Strip[0].mute" "1" "Strip[0].mute" "0"` → `{"ok":true}` or `{"ok":false,"error":"…"}`. Args are `name value` pairs; a value parseable as a number → `SetParameterFloat`, else `SetParameterStringA`.

> This is integration glue. It is NOT unit-tested; it is validated by the smoke script at the Task 8 hard checkpoint. Discovery looks up the install dir from the registry, then loads `VoicemeeterRemote64.dll` from there.

- [ ] **Step 1: Write the script**

Create `resources/voicemeeter-bridge.ps1`:

```powershell
# VoiceMeeter Remote bridge for Knob. Emits exactly one JSON line on stdout.
# Subcommands: status | launch | set <name> <value> [<name> <value> ...]
# No native npm dependency — this script is the only path to VoicemeeterRemote64.dll.

$ErrorActionPreference = 'Stop'

function Write-Json($obj) { $obj | ConvertTo-Json -Compress }

function Get-VmInstallDir {
  # VB-Audio records the install dir in the Uninstall key (per the Remote API docs).
  $keys = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\VB:Voicemeeter {17359A74-1236-5467}',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\VB:Voicemeeter {17359A74-1236-5467}'
  )
  foreach ($k in $keys) {
    try {
      if (Test-Path $k) {
        $p = (Get-ItemProperty $k).UninstallString
        if ($p) {
          $dir = Split-Path -Parent ($p -replace '"', '')
          if ($dir -and (Test-Path $dir)) { return $dir }
        }
      }
    } catch {}
  }
  # Fallback: typical install location.
  $fallback = Join-Path ${env:ProgramFiles(x86)} 'VB\Voicemeeter'
  if (Test-Path $fallback) { return $fallback }
  return $null
}

$installDir = Get-VmInstallDir
if (-not $installDir) { Write-Json @{ installed = $false }; exit 0 }

$dll = Join-Path $installDir 'VoicemeeterRemote64.dll'
if (-not (Test-Path $dll)) { Write-Json @{ installed = $false }; exit 0 }

# Make the DLL resolvable for DllImport without an absolute-path import.
Add-Type -Namespace Knob -Name K32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Auto)]
public static extern bool SetDllDirectory(string lpPathName);
'@
[Knob.K32]::SetDllDirectory($installDir) | Out-Null

Add-Type -Namespace Knob -Name VMR -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("VoicemeeterRemote64.dll", CallingConvention=System.Runtime.InteropServices.CallingConvention.Cdecl)]
public static extern int VBVMR_Login();
[System.Runtime.InteropServices.DllImport("VoicemeeterRemote64.dll", CallingConvention=System.Runtime.InteropServices.CallingConvention.Cdecl)]
public static extern int VBVMR_Logout();
[System.Runtime.InteropServices.DllImport("VoicemeeterRemote64.dll", CallingConvention=System.Runtime.InteropServices.CallingConvention.Cdecl)]
public static extern int VBVMR_RunVoicemeeter(int vType);
[System.Runtime.InteropServices.DllImport("VoicemeeterRemote64.dll", CallingConvention=System.Runtime.InteropServices.CallingConvention.Cdecl)]
public static extern int VBVMR_GetVoicemeeterType(ref int pType);
[System.Runtime.InteropServices.DllImport("VoicemeeterRemote64.dll", CallingConvention=System.Runtime.InteropServices.CallingConvention.Cdecl)]
public static extern int VBVMR_GetVoicemeeterVersion(ref int pVersion);
[System.Runtime.InteropServices.DllImport("VoicemeeterRemote64.dll", CallingConvention=System.Runtime.InteropServices.CallingConvention.Cdecl, CharSet=System.Runtime.InteropServices.CharSet.Ansi)]
public static extern int VBVMR_SetParameterFloat(string param, float value);
[System.Runtime.InteropServices.DllImport("VoicemeeterRemote64.dll", CallingConvention=System.Runtime.InteropServices.CallingConvention.Cdecl, CharSet=System.Runtime.InteropServices.CharSet.Ansi)]
public static extern int VBVMR_SetParameterStringA(string param, string value);
'@

function Format-Version($packed) {
  $v1 = ($packed -shr 24) -band 0xFF
  $v2 = ($packed -shr 16) -band 0xFF
  $v3 = ($packed -shr 8) -band 0xFF
  $v4 = $packed -band 0xFF
  "$v1.$v2.$v3.$v4"
}

function Get-Status {
  # VBVMR_Login: 0 = ok & running, 1 = ok but app not launched, <0 = error.
  $login = [Knob.VMR]::VBVMR_Login()
  if ($login -lt 0) { return @{ installed = $true; running = $false } }
  if ($login -eq 1) { [Knob.VMR]::VBVMR_Logout() | Out-Null; return @{ installed = $true; running = $false } }

  $type = 0
  $tr = [Knob.VMR]::VBVMR_GetVoicemeeterType([ref]$type)
  $ver = 0
  [Knob.VMR]::VBVMR_GetVoicemeeterVersion([ref]$ver) | Out-Null
  [Knob.VMR]::VBVMR_Logout() | Out-Null

  $out = @{ installed = $true; running = $true }
  if ($tr -eq 0) { $out.type = $type }
  if ($ver -ne 0) { $out.version = (Format-Version $ver) }
  return $out
}

$cmd = $args[0]
switch ($cmd) {
  'status' {
    Write-Json (Get-Status); exit 0
  }
  'launch' {
    $login = [Knob.VMR]::VBVMR_Login()
    if ($login -eq 1) {
      # Not running — launch Banana (2). Fall back to basic (1) if Banana absent.
      $r = [Knob.VMR]::VBVMR_RunVoicemeeter(2)
      if ($r -ne 0) { [Knob.VMR]::VBVMR_RunVoicemeeter(1) | Out-Null }
      # Poll up to ~8s for the engine to report a type.
      $type = 0
      for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 200
        if ([Knob.VMR]::VBVMR_GetVoicemeeterType([ref]$type) -eq 0) { break }
      }
    }
    [Knob.VMR]::VBVMR_Logout() | Out-Null
    Write-Json (Get-Status); exit 0
  }
  'set' {
    $pairs = $args[1..($args.Count - 1)]
    if (-not $pairs -or $pairs.Count -lt 2 -or ($pairs.Count % 2) -ne 0) {
      Write-Json @{ ok = $false; error = 'set requires name/value pairs' }; exit 0
    }
    $login = [Knob.VMR]::VBVMR_Login()
    if ($login -ne 0) {
      [Knob.VMR]::VBVMR_Logout() | Out-Null
      Write-Json @{ ok = $false; error = 'VoiceMeeter not running' }; exit 0
    }
    try {
      for ($i = 0; $i -lt $pairs.Count; $i += 2) {
        $name = $pairs[$i]
        $val = $pairs[$i + 1]
        $num = 0.0
        if ([float]::TryParse($val, [ref]$num)) {
          [Knob.VMR]::VBVMR_SetParameterFloat($name, $num) | Out-Null
        } else {
          [Knob.VMR]::VBVMR_SetParameterStringA($name, [string]$val) | Out-Null
        }
      }
      Write-Json @{ ok = $true }
    } catch {
      Write-Json @{ ok = $false; error = $_.Exception.Message }
    } finally {
      [Knob.VMR]::VBVMR_Logout() | Out-Null
    }
    exit 0
  }
  default {
    Write-Json @{ ok = $false; error = "unknown command: $cmd" }; exit 0
  }
}
```

- [ ] **Step 2: Smoke the `status` path on THIS machine (no VoiceMeeter installed)**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File resources/voicemeeter-bridge.ps1 status`
Expected: `{"installed":false}` (VoiceMeeter is not installed on the dev box — this proves the not-installed path and that the script parses/runs).

- [ ] **Step 3: Commit**

```bash
git add resources/voicemeeter-bridge.ps1
git commit -m "feat(vm): PowerShell bridge — registry discovery + Remote DLL P/Invoke"
```

---

## Task 5: `VoiceMeeterService` real impl + bridge discovery + factory

**Files:**
- Create: `src/main/voicemeeter/voicemeeterBridge.ts`
- Create: `src/main/voicemeeter/PsVoiceMeeterService.ts`
- Create: `src/main/voicemeeter/index.ts`

**Interfaces:**
- Consumes: `parseVmStatus` (Task 2), `VoiceMeeterService`/`VmApplyResult` (Task 3), `MockVoiceMeeterService` (Task 3).
- Produces:
  - `resolveBridgeScript(): string | null` — packaged: `process.resourcesPath/voicemeeter-bridge.ps1`; dev: repo `resources/voicemeeter-bridge.ps1`.
  - `class PsVoiceMeeterService implements VoiceMeeterService`
  - `createVoiceMeeterService(): VoiceMeeterService`

- [ ] **Step 1: Bridge discovery (mirror `resolveMmtPath`)**

Create `src/main/voicemeeter/voicemeeterBridge.ts`:

```typescript
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const SCRIPT = 'voicemeeter-bridge.ps1'

/** Locate the bundled bridge script (packaged → resourcesPath; dev → repo resources/). */
export function resolveBridgeScript(): string | null {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath ?? '', SCRIPT),
        join(app.getAppPath(), 'resources', SCRIPT)
      ]
    : [join(process.cwd(), 'resources', SCRIPT)]
  return candidates.find((p) => existsSync(p)) ?? null
}
```

- [ ] **Step 2: Real service that shells out to the script**

Create `src/main/voicemeeter/PsVoiceMeeterService.ts`:

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import log from '../logger'
import type { VmSetParam, VmStatus } from '../../shared/types'
import { parseVmStatus } from './vmParse'
import type { VmApplyResult, VoiceMeeterService } from './VoiceMeeterService'

const execFileAsync = promisify(execFile)

export class PsVoiceMeeterService implements VoiceMeeterService {
  readonly isMock = false

  constructor(private readonly scriptPath: string) {
    if (!existsSync(scriptPath)) throw new Error(`bridge script not found at ${scriptPath}`)
  }

  private run(args: string[], timeout: number): Promise<string> {
    return execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath, ...args],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 }
    ).then(({ stdout }) => stdout)
  }

  async getStatus(): Promise<VmStatus> {
    try {
      return parseVmStatus(await this.run(['status'], 10_000))
    } catch (err) {
      log.error('[vm] getStatus failed:', err)
      return { state: 'not-installed' }
    }
  }

  async launch(): Promise<VmStatus> {
    try {
      return parseVmStatus(await this.run(['launch'], 15_000))
    } catch (err) {
      log.error('[vm] launch failed:', err)
      return { state: 'not-installed' }
    }
  }

  async setParams(params: VmSetParam[]): Promise<VmApplyResult> {
    if (!params.length) return { ok: false, error: 'no params' }
    const flat = params.flatMap((p) => [p.name, String(p.value)])
    try {
      const out = await this.run(['set', ...flat], 10_000)
      const r = JSON.parse(out) as { ok?: boolean; error?: string }
      return { ok: r.ok === true, error: r.error }
    } catch (err) {
      log.error('[vm] setParams failed:', err)
      return { ok: false, error: 'bridge failure' }
    }
  }
}
```

> Note: confirm the logger import style matches the rest of `src/main` (the codebase uses `import log from '../logger'` / `log.error`). If `logger` exports differently, match it.

- [ ] **Step 3: Factory (mirror `createDisplayService`)**

Create `src/main/voicemeeter/index.ts`:

```typescript
import log from '../logger'
import { resolveBridgeScript } from './voicemeeterBridge'
import { MockVoiceMeeterService } from './MockVoiceMeeterService'
import { PsVoiceMeeterService } from './PsVoiceMeeterService'
import type { VoiceMeeterService } from './VoiceMeeterService'

export type { VoiceMeeterService } from './VoiceMeeterService'

export function createVoiceMeeterService(): VoiceMeeterService {
  if (process.platform !== 'win32') return new MockVoiceMeeterService()
  const script = resolveBridgeScript()
  if (!script) {
    log.warn('[vm] bridge script not found; using mock')
    return new MockVoiceMeeterService()
  }
  try {
    return new PsVoiceMeeterService(script)
  } catch (err) {
    log.warn('[vm] init failed, using mock:', err)
    return new MockVoiceMeeterService()
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/voicemeeter/voicemeeterBridge.ts src/main/voicemeeter/PsVoiceMeeterService.ts src/main/voicemeeter/index.ts
git commit -m "feat(vm): PsVoiceMeeterService + bridge discovery + factory"
```

---

## Task 6: IPC wiring (main process)

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `VoiceMeeterService` + `createVoiceMeeterService` (Task 5), `IPC.vmGetStatus/vmLaunch/vmStatusChanged` (Task 1).
- Produces: `registerIpc(audio, display, vm)` now also handles `vm:getStatus`, `vm:launch`, and broadcasts `vm:statusChanged`.

- [ ] **Step 1: Add the VM param + handlers to `registerIpc`**

In `src/main/ipc.ts`:
1. Import: `import type { VoiceMeeterService } from './voicemeeter'`.
2. Change the signature to accept the service:
   `export function registerIpc(audio: SwappableAudioService, display: SwappableDisplayService, vm: VoiceMeeterService) {`
3. Inside, add a broadcaster + handlers (mirroring the display handlers):

```typescript
  const broadcastVmStatus = async (): Promise<void> => {
    try {
      getWindow()?.webContents.send(IPC.vmStatusChanged, await vm.getStatus())
    } catch (err) {
      log.error('[ipc] broadcastVmStatus failed:', err)
    }
  }

  ipcMain.handle(IPC.vmGetStatus, async (): Promise<VmStatus> => {
    try {
      return await vm.getStatus()
    } catch (err) {
      log.error('[ipc] vm:getStatus failed:', err)
      return { state: 'not-installed' }
    }
  })

  ipcMain.handle(IPC.vmLaunch, async (): Promise<VmStatus> => {
    try {
      return await vm.launch()
    } catch (err) {
      log.error('[ipc] vm:launch failed:', err)
      return { state: 'not-installed' }
    } finally {
      await broadcastVmStatus()
    }
  })
```

4. Add `VmStatus` to the type import from `../shared/types` at the top of the file.

- [ ] **Step 2: Construct + pass the service in `src/main/index.ts`**

In `src/main/index.ts`, where `createDisplayService()` is called and `registerIpc(...)` is invoked:

```typescript
import { createVoiceMeeterService } from './voicemeeter'
// ...
const vm = createVoiceMeeterService()
// ...
registerIpc(audio, display, vm)
```

(Match the exact existing variable names for `audio`/`display`.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run the full test suite (no regressions)**

Run: `npm run test`
Expected: PASS (existing suite + `vmParse` tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts
git commit -m "feat(vm): IPC handlers (getStatus/launch) + wiring"
```

---

## Task 7: Preload bridge + renderer status line

**Files:**
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/components/VoiceMeeterStatus.tsx`
- Modify: the Audio view root component (confirm exact path — likely `src/renderer/src/components/AudioView.tsx`; if absent, the view that renders the playback/recording device lists)

**Interfaces:**
- Consumes: `IPC.vmGetStatus/vmLaunch/vmStatusChanged` (Task 1), `VmStatus` (Task 1).
- Produces (on `window.sounddeck`): `getVmStatus()`, `launchVoicemeeter()`, `onVmStatusChanged(cb)`.

- [ ] **Step 1: Expose the channels in preload**

In `src/preload/index.ts`, add to the `api` object (mirroring the display entries):

```typescript
  // ---- voicemeeter ----
  getVmStatus: (): Promise<VmStatus> => ipcRenderer.invoke(IPC.vmGetStatus),
  launchVoicemeeter: (): Promise<VmStatus> => ipcRenderer.invoke(IPC.vmLaunch),
  onVmStatusChanged: (cb: (s: VmStatus) => void): (() => void) =>
    subscribe(IPC.vmStatusChanged, cb),
```

Add `VmStatus` to the `@shared/types` import at the top of the file.

- [ ] **Step 2: Build the status component**

Create `src/renderer/src/components/VoiceMeeterStatus.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { VmStatus } from '@shared/types'

const DOWNLOAD_URL = 'https://vb-audio.com/Voicemeeter/banana.htm'

const editionLabel: Record<string, string> = {
  voicemeeter: 'VoiceMeeter',
  banana: 'Banana',
  potato: 'Potato'
}

export function VoiceMeeterStatus(): JSX.Element {
  const [status, setStatus] = useState<VmStatus>({ state: 'not-installed' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.sounddeck.getVmStatus().then(setStatus)
    return window.sounddeck.onVmStatusChanged(setStatus)
  }, [])

  const launch = async (): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await window.sounddeck.launchVoicemeeter())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {status.state === 'ready' && (
        <span className="text-emerald-400">
          ● VoiceMeeter connected
          {status.edition ? ` — ${editionLabel[status.edition]}` : ''}
          {status.version ? ` (${status.version})` : ''}
        </span>
      )}
      {status.state === 'installed-not-running' && (
        <>
          <span className="text-amber-400">● VoiceMeeter not running</span>
          <button
            onClick={launch}
            disabled={busy}
            className="rounded px-2 py-0.5 bg-white/10 hover:bg-white/20 disabled:opacity-50"
          >
            {busy ? 'Launching…' : 'Launch'}
          </button>
        </>
      )}
      {status.state === 'not-installed' && (
        <span className="text-white/50">
          VoiceMeeter not installed —{' '}
          <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer" className="underline">
            get it
          </a>{' '}
          to enable multi-device audio
        </span>
      )}
    </div>
  )
}
```

> Tailwind class names above follow the existing renderer conventions; adjust accent classes to match the surrounding components if they differ.

- [ ] **Step 3: Render it in the Audio view**

Open the Audio view root. Confirm its path with: `grep -rl "recording" src/renderer/src/components`. Import and render `<VoiceMeeterStatus />` near the top of the audio device section (e.g. under the section header).

```tsx
import { VoiceMeeterStatus } from './VoiceMeeterStatus'
// ...inside the audio view JSX, near the section header:
<VoiceMeeterStatus />
```

- [ ] **Step 4: Update the preload `.d.ts` if it lists methods explicitly**

`src/preload/index.d.ts` exposes `SoundDeckApi` via `typeof api`, so new methods are picked up automatically. Confirm no manual list needs editing.

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 6: Launch the app and visually confirm the not-installed state**

Run: `npm run dev`
Expected: the Audio view shows "VoiceMeeter not installed — get it …" (since VoiceMeeter is absent on this box). No crash; status line renders.

- [ ] **Step 7: Commit**

```bash
git add src/preload/index.ts src/renderer/src/components/VoiceMeeterStatus.tsx src/renderer/src/components/AudioView.tsx
git commit -m "feat(vm): preload bridge + VoiceMeeter status line in Audio view"
```

---

## Task 8: Smoke script + HARD CHECKPOINT

**Files:**
- Create: `scripts/vm-smoke.mjs`
- Modify: `scripts/package-standalone.ps1` (ensure the `.ps1` is bundled)

**Interfaces:**
- Consumes: `resources/voicemeeter-bridge.ps1` (Task 4).

> This task proves the bridge end-to-end on real hardware. Steps 3–4 are the **hard checkpoint** and are BLOCKED until VoiceMeeter Banana is installed (admin + reboot — user action). Do not start Phase 2 until they pass.

- [ ] **Step 1: Write the smoke script**

Create `scripts/vm-smoke.mjs`:

```javascript
// Proves the VoiceMeeter bridge end-to-end. Usage: node scripts/vm-smoke.mjs
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const exec = promisify(execFile)
const script = join(process.cwd(), 'resources', 'voicemeeter-bridge.ps1')

const run = (args) =>
  exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
    windowsHide: true
  }).then(({ stdout }) => stdout.trim())

const main = async () => {
  console.log('status →', await run(['status']))
  // Mute then unmute Strip[0] — a harmless, observable routing change.
  console.log('set mute=1 →', await run(['set', 'Strip[0].mute', '1']))
  console.log('set mute=0 →', await run(['set', 'Strip[0].mute', '0']))
  console.log('status →', await run(['status']))
}

main().catch((e) => {
  console.error('smoke failed:', e)
  process.exitCode = 1
})
```

- [ ] **Step 2: Ensure the `.ps1` ships in the standalone bundle**

In `scripts/package-standalone.ps1`, find where `resources/` icons are copied into the bundle's resources folder. Add (if a blanket `resources/*` copy isn't already present) a line copying `resources/voicemeeter-bridge.ps1` alongside them. Confirm the existing svcl-leak guard does NOT reject `.ps1` files.

- [ ] **Step 3: Run the smoke with VoiceMeeter ABSENT (works now)**

Run: `node scripts/vm-smoke.mjs`
Expected: `status → {"installed":false}` then `set` lines reporting `{"ok":false,"error":"VoiceMeeter not running"}`. Proves the script + Node invocation path with no crash.

- [ ] **Step 4: HARD CHECKPOINT — run the smoke with VoiceMeeter Banana INSTALLED + RUNNING**

Prerequisite (user action): install VoiceMeeter Banana (admin + reboot), launch it.
Run: `node scripts/vm-smoke.mjs`
Expected:
- `status → {"installed":true,"running":true,"type":2,"version":"…"}`
- `set mute=1 → {"ok":true}` and the Strip[0] mute toggles **visibly in the VoiceMeeter window**
- `set mute=0 → {"ok":true}` and it un-mutes

**This is the device-name-binding risk surface.** If `set` succeeds but later device-name binds (Phase 2) don't, that's the iteration the spec (§3) flagged. Capture the exact `status` JSON and whether the mute toggled — this validates the whole bridge contract before Phase 2 builds routing + UI on top.

- [ ] **Step 5: Commit**

```bash
git add scripts/vm-smoke.mjs scripts/package-standalone.ps1
git commit -m "feat(vm): end-to-end smoke script + bundle bridge in standalone"
```

---

## Self-Review

**Spec coverage (Phase 1 scope only — §10 plan 1):**
- PowerShell bridge (.ps1 P/Invoke) → Task 4 ✓
- DLL discovery via registry → Task 4 (`Get-VmInstallDir`) ✓
- `VoiceMeeterService` → Tasks 3 (interface/mock) + 5 (real) ✓
- status / launch / edition detection → Tasks 4 (`status`/`launch`/type) + 2 (`editionFromType`) ✓
- IPC → Task 6 ✓ ; preload → Task 7 ✓
- visible "VoiceMeeter: connected (Banana)" status → Task 7 ✓
- HARD CHECKPOINT (prove one routing change on real hardware) → Task 8 ✓
- not-installed guided UI state → Task 7 ✓
- pure testable core (`parseVmStatus`) → Task 2 ✓

**Deferred to Phase 2 (correctly out of scope here):** `MultiSetup` data model + coercion, `buildRouting`, apply (routing + svcl default switch), Multi-device composer UI, both modes, restore-direct, device-name resolution (`VBVMR_Input/Output_GetDeviceDescA`). The bridge already exposes `setParams`, so Phase 2 builds `buildRouting → setParams` on top with no foundation changes.

**Placeholder scan:** every code step contains complete code; no TBD/TODO. ✓

**Type consistency:** `VmStatus`/`VmEdition`/`VmSetParam`/`VmApplyResult` and `getStatus`/`launch`/`setParams` are used identically across Tasks 1→3→5→6→7. IPC keys `vmGetStatus`/`vmLaunch`/`vmStatusChanged` consistent across Tasks 1/6/7. ✓

**Known unknowns to confirm during execution (not blockers):**
1. Exact Audio view component filename (Task 7 Step 3 — grep confirms).
2. Logger import shape in `src/main` (Task 5 Step 2 note).
3. The VB-Audio Uninstall registry GUID (`{17359A74-…}`) — Task 4's `Get-VmInstallDir` has a fallback to `ProgramFiles(x86)\VB\Voicemeeter`; verify/adjust the GUID against a real install at the Task 8 checkpoint.
