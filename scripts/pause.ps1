# Pause the deployment to minimize Azure cost (fully reversible — see resume.ps1).
#
# It scales the worker to 0 replicas (the bot goes offline; compute ≈ $0) and
# stops the Postgres compute (you then pay only for database storage). No data or
# configuration is lost. Resource names come from the gitignored
# scripts/deploy.local.ps1 (copy from deploy.local.ps1.example).
#
# NOTE: a stopped Postgres Flexible Server is auto-started by Azure after ~7 days;
# just run this again if you want it to stay paused longer.

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

Write-Host "Pausing: $app -> 0 replicas; stopping Postgres compute ($pg)" -ForegroundColor Cyan
az containerapp update -n $app -g $rg --min-replicas 0 -o none
az postgres flexible-server stop -n $pg -g $rg -o none
Write-Host "Paused. Compute billing stops; you still pay DB storage + the registry's flat fee. Run scripts/resume.ps1 to bring it back." -ForegroundColor Green
