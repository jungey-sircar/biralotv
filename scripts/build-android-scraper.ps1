$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$scraperDir = Join-Path $root 'stream-scraper'
$jniDir = Join-Path $root 'android\app\src\main\jniLibs'

$ndkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk\ndk'
if (-not $env:ANDROID_NDK_HOME) {
  $ndkDir = Get-ChildItem $ndkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
} else {
  $ndkDir = $env:ANDROID_NDK_HOME
}
if (-not $ndkDir -or -not (Test-Path $ndkDir)) {
  throw "Android NDK not found under $ndkRoot"
}

$binDir = Join-Path $ndkDir 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$goExe = Join-Path $root 'tools\go\bin\go.exe'
if (-not (Test-Path $goExe)) {
  $goExe = 'go'
}

$targets = @(
  @{ Abi = 'arm64-v8a';   Arch = 'arm64'; GoArm = '';  Cc = 'aarch64-linux-android24-clang.cmd' },
  @{ Abi = 'armeabi-v7a'; Arch = 'arm';   GoArm = '7'; Cc = 'armv7a-linux-androideabi24-clang.cmd' },
  @{ Abi = 'x86_64';      Arch = 'amd64'; GoArm = '';  Cc = 'x86_64-linux-android24-clang.cmd' },
  @{ Abi = 'x86';         Arch = '386';   GoArm = '';  Cc = 'i686-linux-android24-clang.cmd' }
)

Push-Location $scraperDir
try {
  foreach ($t in $targets) {
    $ccPath = Join-Path $binDir $t.Cc
    if (-not (Test-Path $ccPath)) {
      throw "Missing NDK compiler: $ccPath"
    }
    $outAbiDir = Join-Path $jniDir $t.Abi
    New-Item -ItemType Directory -Force -Path $outAbiDir | Out-Null
    $outSo = Join-Path $outAbiDir 'libstreamscraper.so'

    $env:GOOS = 'android'
    $env:GOARCH = $t.Arch
    if ($t.GoArm) { $env:GOARM = $t.GoArm } else { Remove-Item Env:GOARM -ErrorAction SilentlyContinue }
    $env:CGO_ENABLED = '1'
    $env:CC = $ccPath

    Write-Host "Building $($t.Abi) ($($t.Arch)) -> $outSo"
    & $goExe build -buildmode=c-shared -buildvcs=false -ldflags="-s -w -extldflags=-Wl,-z,max-page-size=16384" -o $outSo .
    if ($LASTEXITCODE -ne 0) {
      throw "Go build failed for $($t.Abi) with exit code $LASTEXITCODE"
    }

    $headerFile = [System.IO.Path]::ChangeExtension($outSo, '.h')
    if (Test-Path $headerFile) {
      Remove-Item $headerFile -Force
    }
  }
} finally {
  Remove-Item Env:GOOS -ErrorAction SilentlyContinue
  Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
  Remove-Item Env:GOARM -ErrorAction SilentlyContinue
  Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:CC -ErrorAction SilentlyContinue
  Pop-Location
}

Write-Host "Done building libstreamscraper.so for all ABIs."

