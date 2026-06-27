# Resume a deployment paused by pause.ps1.
#
# Starts the Postgres compute and scales the worker back to 1 replica (the bot
# reconnects to Discord in ~30s). Resource names come from the gitignored
# scripts/deploy.local.ps1.

$ErrorActionPreference = "Stop"

$azDir = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"
if ((Test-Path $azDir) -and ($env:PATH -notlike "*$azDir*")) { $env:PATH = "$azDir;$env:PATH" }

$localCfg = Join-Path $PSScriptRoot "deploy.local.ps1"
if (Test-Path $localCfg) { . $localCfg }
$rg  = $env:VTA_RESOURCE_GROUP
$app = $env:VTA_CONTAINER_APP
$pg  = $env:VTA_POSTGRES_SERVER
if (-not $rg -or -not $app -or -not $pg) {
  throw "Missing config. Set VTA_RESOURCE_GROUP / VTA_CONTAINER_APP / VTA_POSTGRES_SERVER in scripts/deploy.local.ps1 (see deploy.local.ps1.example)."
}

Write-Host "Resuming: starting Postgres ($pg); $app -> 1 replica" -ForegroundColor Cyan
az postgres flexible-server start -n $pg -g $rg -o none
az containerapp update -n $app -g $rg --min-replicas 1 -o none
Write-Host "Resumed. The bot reconnects to Discord shortly." -ForegroundColor Green
