#!/usr/bin/env bash
# print-github-config.sh
#
# Queries the existing Merlin-managed Service Principals and prints the GitHub
# Secrets / Variables needed for each project's GitHub Actions workflows.
#
# Prerequisites:
#   - merlin deploy has already been run (resources must exist)
#   - You are logged in via `az login`
#
# Usage:
#   ./print-github-config.sh [--ring test|staging]

set -euo pipefail

RING="${1:-}"
if [[ "$RING" == "--ring" ]]; then
  RING="$2"
fi
if [[ -z "$RING" ]]; then
  RING="test"
fi

case "$RING" in
  test)    RING_SHORT="tst" ;;
  staging) RING_SHORT="stg" ;;
  *) echo "Unknown ring: $RING (use test or staging)"; exit 1 ;;
esac

SP_DISPLAY_NAME="merlin-github-${RING_SHORT}"

echo "=========================================="
echo " Merlin GitHub Config Printer"
echo " Ring: ${RING}  (SP display name: ${SP_DISPLAY_NAME})"
echo "=========================================="
echo ""

# ── Look up SP ────────────────────────────────────────────────────────────────
APP_JSON=$(az ad app list --filter "displayName eq '${SP_DISPLAY_NAME}'" --output json 2>/dev/null)
APP_COUNT=$(echo "$APP_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [[ "$APP_COUNT" == "0" ]]; then
  echo "ERROR: AD App '${SP_DISPLAY_NAME}' not found."
  echo "       Run 'merlin deploy' first to create the Service Principal."
  exit 1
fi

CLIENT_ID=$(echo "$APP_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['appId'])")
TENANT_ID=$(az account show --query tenantId -o tsv)
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

echo "── GitHub Secrets ────────────────────────────────────────────────────────"
echo ""
echo "  AZURE_CLIENT_ID       = ${CLIENT_ID}"
echo "  AZURE_TENANT_ID       = ${TENANT_ID}"
echo "  AZURE_SUBSCRIPTION_ID = ${SUBSCRIPTION_ID}"
echo ""
echo "── GitHub Variables (per environment) ───────────────────────────────────"
echo ""

for REGION in koreacentral eastasia; do
  case "$REGION" in
    koreacentral) REGION_SHORT="krc" ;;
    eastasia)     REGION_SHORT="eas" ;;
  esac

  echo "  Environment: ${RING}-${REGION_SHORT}"
  echo ""

  # Shared ACR (project: merlin)
  ACR_NAME="merlinshared${RING_SHORT}${REGION_SHORT}acr"
  ACR_SERVER="${ACR_NAME}.azurecr.io"
  echo "  REGISTRY_SERVER = ${ACR_SERVER}"
  echo ""
done
