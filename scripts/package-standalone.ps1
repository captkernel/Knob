# Builds a standalone, double-clickable SoundDeck.exe WITHOUT electron-builder.
#
# Why: electron-builder's full NSIS/portable targets download "winCodeSign",
# whose archive contains macOS symlinks that Windows refuses to extract unless
# Developer Mode (or admin) is enabled ("A required privilege is not held by the
# client"). This script does what `electron-builder --dir` would do - bundle the
# Electron runtime + our app - using only robocopy, so it needs no privileges.
#
# Usage:   npm run build   ; then   powershell -File scripts/package-standalone.ps1
# Output:  release/SoundDeck/SoundDeck.exe  (self-contained app folder)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'release\SoundDeck'
$electron = Join-Path $root 'node_modules\electron\dist'

if (-not (Test-Path (Join-Path $root 'out\main\index.js'))) {
  throw "out/ not found - run 'npm run build' first."
}

# Fresh output dir
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force $dest | Out-Null

# 1) Electron runtime
robocopy $electron $dest /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null

# 2) Rename electron.exe -> SoundDeck.exe
Rename-Item (Join-Path $dest 'electron.exe') 'SoundDeck.exe'

# 3) Replace Electron's default app with ours (resources/app)
Remove-Item (Join-Path $dest 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue
$appDir = Join-Path $dest 'resources\app'
New-Item -ItemType Directory -Force $appDir | Out-Null
Copy-Item (Join-Path $root 'package.json') (Join-Path $appDir 'package.json') -Force
robocopy (Join-Path $root 'out') (Join-Path $appDir 'out') /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null

# 4) Bundle the tray icons. svcl.exe is intentionally NOT bundled (NirSoft license);
# the app downloads it on first run into userData. See src/main/svclInstaller.ts.
Copy-Item (Join-Path $root 'resources\*.png') (Join-Path $dest 'resources') -Force -ErrorAction SilentlyContinue

# 5) Verify the build. The core app + exe must exist (fatal). Guard against svcl.exe
# accidentally leaking into the bundle (would be the redistribution we must avoid).
$appEntry = Join-Path $appDir 'out\main\index.js'
$exe = Join-Path $dest 'SoundDeck.exe'
if (-not (Test-Path $appEntry)) { throw "Packaging failed: app entry missing at $appEntry" }
if (-not (Test-Path $exe)) { throw "Packaging failed: SoundDeck.exe missing at $exe" }

$leaked = Get-ChildItem -Path $dest -Recurse -Filter 'svcl.exe' -ErrorAction SilentlyContinue
if ($leaked) { throw "REDISTRIBUTION GUARD: svcl.exe found in the bundle ($($leaked.FullName)). It must NOT be shipped - the app downloads it on first run." }

if (-not (Test-Path (Join-Path $dest 'resources\tray-icon.png'))) {
  Write-Warning "tray-icon.png NOT bundled - the tray will use a blank icon. Run 'npm run build' (gen-icons) first."
}

Write-Host "Standalone app ready: $exe"
Write-Host "(svcl.exe is downloaded on first run; the app starts on sample data until then.)"
