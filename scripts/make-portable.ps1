# Packages the release exe as a portable zip: the exe plus PORTABLE.txt, which
# switches the app to keeping all its data in a folder next to the exe.
# Run after `npm run tauri build -- --no-bundle` (or use `npm run portable`).
param([string]$TargetDir = "target")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot
$version = (Get-Content "$root\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version
# -TargetDir lets the exe come from another build folder (relative to src-tauri).
$exe = "$root\src-tauri\$TargetDir\release\bolzano-jobs.exe"
if (-not (Test-Path $exe)) { throw "Release exe not found at $exe. Build it first." }

$out = "$root\src-tauri\target\release\bundle\portable"
# Stage in a fresh temp folder, never in $out: someone may have run the portable
# exe straight from $out, and its "Bolzano Jobs Data" folder must survive rebuilds.
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "bolzano-portable-$([guid]::NewGuid())"
$stage = "$tmp\Bolzano Jobs"
New-Item -ItemType Directory $stage -Force | Out-Null
New-Item -ItemType Directory $out -Force | Out-Null

Copy-Item $exe "$stage\Bolzano Jobs.exe"
@"
Bolzano Jobs $version - portable

This file switches the app to portable mode. Everything it saves (jobs, notes,
pipeline, settings, window position) goes into the "Bolzano Jobs Data" folder
next to the exe, and nothing is written to the Windows user profile.

Unzip this folder somewhere permanent (e.g. Documents or a USB stick) before
using it: your data lives inside it.

Delete this file to use the normal installed-style data location instead.

Requires the Microsoft Edge WebView2 runtime, which Windows 10 and 11 include.
"@ | Set-Content "$stage\PORTABLE.txt" -Encoding utf8

$zip = "$out\Bolzano Jobs $version portable x64.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $stage -DestinationPath $zip
# Refresh the ready-to-run copy in $out: only the exe and PORTABLE.txt are
# replaced, so a "Bolzano Jobs Data" folder already there is left untouched.
New-Item -ItemType Directory "$out\Bolzano Jobs" -Force | Out-Null
Copy-Item "$stage\Bolzano Jobs.exe", "$stage\PORTABLE.txt" "$out\Bolzano Jobs" -Force
Remove-Item $tmp -Recurse -Force
"Portable build: $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 2)) MB)"
