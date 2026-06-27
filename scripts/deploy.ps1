# Roll the deployed worker to an image already built & pushed by CI.
#
# NO local Docker is needed: GitHub Actions builds and pushes the image to the
# registry on every push to main (see .github/workflows/build-and-deploy.yml).
# This script only asks Azure Container Apps to create a new revision from that
# image, using YOUR interactive `az` login.
#
# CONFIG: the (non-secret) Azure resource names are kept OUT of this public repo.
# Set them once in a local, gitignored file:
#     cp scripts/deploy.local.ps1.example scripts/deploy.local.ps1
#     # edit scripts/deploy.local.ps1 with your registry / resource group / app
# (or export the VTA_* environment variables yourself).
#
# Usage:
#   pwsh scripts/deploy.ps1            # roll to :latest
#   pwsh scripts/deploy.ps1 -Tag <git-sha>   # roll to a specific build

param([string]$Tag = "latest")

$ErrorActionPreference = "Stop"

# az is not always on PATH; add the common Windows install dir if present.
$azDir = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"
if ((Test-Path $azDir) -and ($env:PATH -notlike "*$azDir*")) {
  $env:PATH = "$azDir;$env:PATH"
}

# Load local, gitignored resource config (sets the VTA_* env vars below).
$localCfg = Join-Path $PSScriptRoot "deploy.local.ps1"
if (Test-Path $localCfg) { . $localCfg }

$registry = $env:VTA_ACR_LOGIN_SERVER
$image    = $env:VTA_IMAGE_NAME
$rg       = $env:VTA_RESOURCE_GROUP
$app      = $env:VTA_CONTAINER_APP

if (-not $registry -or -not $image -or -not $rg -or -not $app) {
  throw "Missing deploy config. Copy scripts/deploy.local.ps1.example to scripts/deploy.local.ps1 and fill it in (or set VTA_ACR_LOGIN_SERVER / VTA_IMAGE_NAME / VTA_RESOURCE_GROUP / VTA_CONTAINER_APP)."
}

$ref = "$registry/${image}:$Tag"
Write-Host "Rolling $app -> $ref" -ForegroundColor Cyan
az containerapp update `
  -n $app `
  -g $rg `
  --image $ref `
  --query "{state:properties.provisioningState, image:properties.template.containers[0].image, revision:properties.latestRevisionName}" `
  -o table

Write-Host "Done. The new revision will become active and the bot reconnects in ~30s." -ForegroundColor Green
