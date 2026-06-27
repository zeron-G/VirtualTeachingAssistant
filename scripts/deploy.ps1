# Roll the deployed Discord worker to an image already built & pushed by CI.
#
# NO local Docker is needed: GitHub Actions builds and pushes the image to ACR on
# every push to main (see .github/workflows/build-and-deploy.yml). This script
# only asks Azure Container Apps to create a new revision from that image, using
# YOUR interactive `az` login.
#
# WHY this is a separate local step: the tenant blocks service-principal creation
# and role assignments, so CI has no Azure identity allowed to update the app —
# but your own account (Contributor) can. To make deploys fully automatic later,
# a subscription Owner just needs to grant the managed identity a role and flip a
# flag (one-time):
#   az role assignment create \
#     --assignee 75791801-f740-4fb7-bcf9-6e7dde6ca55d \
#     --role Contributor \
#     --scope /subscriptions/530d4204-b4df-48a6-9581-196248aa95f0/resourceGroups/VirtualTeachingAssistant
#   gh variable set AUTO_DEPLOY -R zeron-G/VirtualTeachingAssistant --body true
#
# Usage:
#   pwsh scripts/deploy.ps1            # roll to :latest
#   pwsh scripts/deploy.ps1 -Tag <git-sha>   # roll to a specific build

param([string]$Tag = "latest")

$ErrorActionPreference = "Stop"

# az is not on the default PATH on this machine; add its install dir if needed.
$azDir = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"
if ((Test-Path $azDir) -and ($env:PATH -notlike "*$azDir*")) {
  $env:PATH = "$azDir;$env:PATH"
}

$registry = "vtaacri35td7bkyqi2a.azurecr.io"
$image = "$registry/vta-discord-worker:$Tag"

Write-Host "Rolling vta-discord-worker -> $image" -ForegroundColor Cyan
az containerapp update `
  -n vta-discord-worker `
  -g VirtualTeachingAssistant `
  --image $image `
  --query "{state:properties.provisioningState, image:properties.template.containers[0].image, revision:properties.latestRevisionName}" `
  -o table

Write-Host "Done. The new revision will become active and the bot reconnects in ~30s." -ForegroundColor Green
