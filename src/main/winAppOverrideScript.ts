// Pure builder for the PowerShell command that clears Windows per-app audio device
// overrides — no Electron/child_process, so it is unit-testable. The `-match` filter
// is the only guard between "clear per-app overrides" and deleting more than intended,
// so it's worth testing in isolation.
//
// Windows stores per-application audio device overrides under this key. When an app
// has an override it IGNORES the system default and keeps playing on its pinned device
// — which makes "I switched the default but app X didn't move" look like a bug. svcl
// can only SET overrides, never clear them, and Windows ships no CLI for it, so we
// delete the per-app entries directly (exactly what Settings -> "Reset" does).
export const POLICY_KEY =
  'HKCU:\\SOFTWARE\\Microsoft\\Internet Explorer\\LowRegistry\\Audio\\PolicyConfig\\PropertyStore'

/**
 * Build the script that deletes ONLY per-app entries — those whose value carries a
 * process path (`\Device\HarddiskVolume...`). Role/system entries are left untouched,
 * and the whole thing is a no-op if the key doesn't exist.
 */
export function buildClearOverridesScript(policyKey: string = POLICY_KEY): string {
  return (
    `$k='${policyKey}';` +
    `if (Test-Path $k) {` +
    `Get-ChildItem $k | Where-Object {` +
    `(Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).'(default)' -match '\\\\Device\\\\HarddiskVolume'` +
    `} | ForEach-Object { Remove-Item $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue } }`
  )
}
