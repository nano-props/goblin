#!/usr/bin/env pwsh
# Fast-reinstall Goblin on Windows. Mirrors install.sh: builds the dir
# target only (no NSIS .exe packaging) and moves the unpacked app into
# %LOCALAPPDATA%\Programs\Goblin[-arm64], closing any running instance
# first. Windows-only.
#
# Usage:
#   .\install.ps1 [options]
#
# Mirror env vars take a URL; leave unset/empty to disable a mirror:
#   ELECTRON_MIRROR, ELECTRON_BUILDER_BINARIES_MIRROR
#   -Npmmirror sets both to the npmmirror defaults.
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$AppName = 'Goblin'

$SkipTypecheck = if ($env:SKIP_TYPECHECK) { $env:SKIP_TYPECHECK } else { '1' }
$SkipRebuild   = if ($env:SKIP_REBUILD)   { $env:SKIP_REBUILD }   else { '1' }
$NpmMirrorElectron  = if ($env:NPM_MIRROR_ELECTRON)  { $env:NPM_MIRROR_ELECTRON }  else { 'https://npmmirror.com/mirrors/electron/' }
$NpmMirrorBinaries = if ($env:NPM_MIRROR_BINARIES) { $env:NPM_MIRROR_BINARIES } else { 'https://npmmirror.com/mirrors/electron-builder-binaries/' }

function Show-Usage {
  @"
Usage: .\install.ps1 [options]

Fast-reinstall Goblin into %LOCALAPPDATA%\Programs\Goblin[-arm64].
Defaults enable the skip-rebuild + skip-typecheck fast path but do NOT
touch mirrors — pass -Npmmirror (or set ELECTRON_MIRROR /
ELECTRON_BUILDER_BINARIES_MIRROR) when GitHub is unreachable. Pass
-Full to run the full typecheck + rebuild pipeline.

  -Clean                Clear electron / electron-builder caches before building.
  -Npmmirror            Route electron + electron-builder-binaries downloads
                        through npmmirror (equivalent to setting both
                        ELECTRON_MIRROR and ELECTRON_BUILDER_BINARIES_MIRROR).
  -Mirror <URL>         Electron download mirror (overrides -Npmmirror).
  -BinariesMirror <URL> electron-builder-binaries mirror (overrides -Npmmirror).
  -Full                 Force-run typecheck + @electron/rebuild (disable the
                        skip-* fast-path defaults).

Mirror env vars take a URL; leave unset/empty to disable:
  ELECTRON_MIRROR, ELECTRON_BUILDER_BINARIES_MIRROR
"@
}

$ExtraArgs = @()
$Npmmirror = $false
$Mirror = $null
$BinariesMirror = $null
$Clean = $false
$Full = $false

$i = 0
while ($i -lt $args.Count) {
  switch ($args[$i]) {
    '-Clean'        { $Clean = $true }
    '-Npmmirror'    { $Npmmirror = $true }
    '-Mirror'       { $i++; $Mirror = $args[$i] }
    '-BinariesMirror' { $i++; $BinariesMirror = $args[$i] }
    '-Full'         { $Full = $true }
    '-h'            { Show-Usage; exit 0 }
    '--help'        { Show-Usage; exit 0 }
    default         { Write-Error "Unknown arg: $($args[$i])`n$(Show-Usage)"; exit 2 }
  }
  $i++
}

if ($Npmmirror) {
  $env:ELECTRON_MIRROR = $NpmMirrorElectron
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = $NpmMirrorBinaries
}
if ($Mirror)        { $env:ELECTRON_MIRROR = $Mirror }
if ($BinariesMirror){ $env:ELECTRON_BUILDER_BINARIES_MIRROR = $BinariesMirror }

if ($Full) {
  $SkipTypecheck = '0'
  $SkipRebuild   = '0'
}

$env:SKIP_TYPECHECK = $SkipTypecheck
$env:SKIP_REBUILD   = $SkipRebuild

if ($Clean) { $ExtraArgs += '--clean' }

# Go through bun to match package.json's build script — the build script
# itself shells out to bun install / bun run ..., so requiring bun here
# keeps the toolchain assumption in one place.
bun scripts/build.ts install @ExtraArgs

# Restart a previously-running Goblin.exe if one was open when we
# started. closeRunningApp() inside build.ts already closed it before
# the rename; launching the fresh binary mirrors the macOS install.sh
# behaviour (which `open`s the new .app).
Write-Host "Restarting $AppName..."
Start-Process -FilePath (Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') $AppName) -ErrorAction SilentlyContinue