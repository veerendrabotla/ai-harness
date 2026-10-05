# AI Harness one-line installer (Windows PowerShell).
#
#   irm https://raw.githubusercontent.com/veerendrabotla/ai-harness/main/install.ps1 | iex
#
# Downloads the release compose file, generates a .env with fresh secrets, and
# boots the full stack from prebuilt GHCR images. No repository clone needed.
#
# Env overrides:
#   AI_H_INSTALL_DIR   install directory        (default: $env:USERPROFILE\.ai-harness)
#   AI_H_BASE_URL      raw file base URL        (default: repo main branch)
#   AI_H_CONFIG_ONLY   "1" = generate files + validate compose, skip boot
#   AI_H_NO_BROWSER    "1" = do not open the browser when finished
#   AI_H_PORT_WEB/API/PG/REDIS/GW   host ports  (default: 3000/4000/5432/6379/4010)
$ErrorActionPreference = "Stop"

function Fail([string]$msg) { Write-Error "error: $msg"; exit 1 }

$Base  = if ($env:AI_H_BASE_URL) { $env:AI_H_BASE_URL } else { "https://raw.githubusercontent.com/veerendrabotla/ai-harness/main" }
$Dir   = if ($env:AI_H_INSTALL_DIR) { $env:AI_H_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".ai-harness" }

Write-Host "==> AI Harness installer"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "Docker is required. Install Docker Desktop from https://docs.docker.com/products/docker-desktop/ and re-run." }
try { docker compose version 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { throw } } catch { Fail "Docker Compose v2 is required (docker compose)." }

function Test-PortBusy([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $iar = $c.BeginConnect("127.0.0.1", $p, $null, $null); if (-not $iar.AsyncWaitHandle.WaitOne(300)) { return $false }; return $c.Connected } catch { return $false } finally { $c.Close() }
}

$web    = if ($env:AI_H_PORT_WEB)    { [int]$env:AI_H_PORT_WEB }    else { 3000 }
$api    = if ($env:AI_H_PORT_API)    { [int]$env:AI_H_PORT_API }    else { 4000 }
$pg     = if ($env:AI_H_PORT_PG)     { [int]$env:AI_H_PORT_PG }     else { 5432 }
$redis  = if ($env:AI_H_PORT_REDIS)  { [int]$env:AI_H_PORT_REDIS }  else { 6379 }
$gw     = if ($env:AI_H_PORT_GW)     { [int]$env:AI_H_PORT_GW }     else { 4010 }

if (-not $env:AI_H_PORT_WEB) {
  $busy = @()
  foreach ($p in @($web, $api, $pg, $redis, $gw)) { if (Test-PortBusy $p) { $busy += $p } }
  if ($busy.Count -gt 0) {
    Write-Host "==> Ports busy on this machine: $($busy -join ', ') - using +100 offset"
    $web += 100; $api += 100; $pg += 100; $redis += 100; $gw += 100
  }
}

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Write-Host "==> Installing to $Dir (web=$web api=$api)"

try {
  Invoke-WebRequest -Uri "$Base/docker-compose.release.yml" -OutFile (Join-Path $Dir "docker-compose.release.yml") -UseBasicParsing
  Invoke-WebRequest -Uri "$Base/.env.example" -OutFile (Join-Path $Dir ".env.example") -UseBasicParsing
} catch { Fail "could not download compose files: $($_.Exception.Message)" }

function New-Secret([int]$bytes) {
  $buf = New-Object byte[] $bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($buf)
  $rng.Dispose()
  [Convert]::ToBase64String($buf)
}

$jwt   = New-Secret 48
$csrf  = New-Secret 48
$enc   = New-Secret 32
$bridge = New-Secret 48

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$out = New-Object System.Collections.Generic.List[string]
foreach ($line in [IO.File]::ReadAllLines((Join-Path $Dir ".env.example"))) {
  if     ($line -like "JWT_ACCESS_SECRET=*")     { $out.Add("JWT_ACCESS_SECRET=$jwt") }
  elseif ($line -like "CSRF_SECRET=*")           { $out.Add("CSRF_SECRET=$csrf") }
  elseif ($line -like "ENCRYPTION_KEY=*")        { $out.Add("ENCRYPTION_KEY=$enc") }
  elseif ($line -like "BRIDGE_INTERNAL_TOKEN=*") { $out.Add("BRIDGE_INTERNAL_TOKEN=$bridge") }
  elseif ($line -like "FRONTEND_ORIGIN=*")       { $out.Add("FRONTEND_ORIGIN=http://localhost:$web") }
  elseif ($line -like "API_BASE_URL=*")          { $out.Add("API_BASE_URL=http://localhost:$api") }
  elseif ($line -like "NEXT_PUBLIC_API_URL=*")   { $out.Add("NEXT_PUBLIC_API_URL=http://localhost:$api") }
  elseif ($line -like "AI_H_PORT_*")             { }
  else                                           { $out.Add($line) }
}
$out.Add("AI_H_PORT_WEB=$web")
$out.Add("AI_H_PORT_API=$api")
$out.Add("AI_H_PORT_PG=$pg")
$out.Add("AI_H_PORT_REDIS=$redis")
$out.Add("AI_H_PORT_GW=$gw")
[IO.File]::WriteAllLines((Join-Path $Dir ".env"), $out, $utf8NoBom)
Write-Host "==> .env created with fresh secrets"

Push-Location $Dir
try {
  $env:COMPOSE_FILE = "docker-compose.release.yml"
  docker compose config -q
  if ($LASTEXITCODE -ne 0) { Fail "compose validation failed" }

  if ($env:AI_H_CONFIG_ONLY -eq "1") {
    Write-Host "==> Config-only mode: compose file validated, not booting."
    exit 0
  }

  Write-Host "==> Pulling images and starting the stack (first run downloads ~1 GB)..."
  docker compose pull
  if ($LASTEXITCODE -ne 0) { Fail "image pull failed" }
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { Fail "docker compose up failed" }

  Write-Host "==> Waiting for the API to become healthy..."
  $healthy = $false
  for ($i = 1; $i -le 60; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri "http://localhost:$api/healthz" -UseBasicParsing -TimeoutSec 5
      if ($resp.Content -like '*"status":"ok"*') {
        $webCode = "000"
        try { $webCode = (Invoke-WebRequest -Uri "http://localhost:$web" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { $webCode = "$($_.Exception.Response.StatusCode.value__)" }
        if ("$webCode" -eq "200") { $healthy = $true; break }
        Write-Host "    API healthy, frontend not ready yet (got $webCode)..."
      }
    } catch { }
    Write-Host "    waiting... ($i/60)"
    Start-Sleep -Seconds 5
  }

  if (-not $healthy) {
    Write-Host "error: stack did not become healthy in time. Recent logs:"
    docker compose logs --tail 60 migrate api frontend
    exit 1
  }

  Write-Host ""
  Write-Host "AI Harness is up and running."
  Write-Host "  Web app:  http://localhost:$web"
  Write-Host "  API docs: http://localhost:$api/docs"
  Write-Host "  Stop:     docker compose -f `"$Dir\docker-compose.release.yml`" down"
  Write-Host "  Update:   docker compose -f `"$Dir\docker-compose.release.yml`" pull && docker compose up -d"

  if ($env:AI_H_NO_BROWSER -ne "1" -and -not $env:CI) {
    Start-Process "http://localhost:$web"
  }
} finally {
  Pop-Location
}
