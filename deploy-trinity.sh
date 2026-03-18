#!/usr/bin/env bash
# deploy-trinity.sh
#
# Compiles and deploys all Trinity + Alluneed resources via Merlin.
#
# Usage:
#   ./deploy-trinity.sh [--ring test|staging] [--region koreacentral|eastasia] [--execute]
#
# Default: dry-run for ring=test, region=koreacentral
#
# Examples:
#   ./deploy-trinity.sh                                      # dry-run, test / koreacentral
#   ./deploy-trinity.sh --ring staging --region eastasia     # dry-run, staging / eastasia
#   ./deploy-trinity.sh --ring test --execute                # execute, test / koreacentral

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RING="test"
REGION="koreacentral"
EXECUTE_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ring)     RING="$2";   shift 2 ;;
    --region)   REGION="$2"; shift 2 ;;
    --execute)  EXECUTE_FLAG="--execute"; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

echo "=========================================="
echo " Merlin Deploy: Trinity + Alluneed"
echo " Ring:    ${RING}"
echo " Region:  ${REGION}"
echo " Execute: ${EXECUTE_FLAG:-dry-run}"
echo "=========================================="

# ── Staging directory ─────────────────────────────────────────────────────────
STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT

# Shared infrastructure (ACR, ACAE, LAW, Redis, Postgres, ABS, AKV)
cp "$SCRIPT_DIR"/shared-resource/*.yml "$STAGING_DIR/"

# Trinity services
cp "$SCRIPT_DIR"/trinity-web-resource/*.yml          "$STAGING_DIR/"
cp "$SCRIPT_DIR"/trinity-worker-resource/*.yml        "$STAGING_DIR/"
cp "$SCRIPT_DIR"/trinity-admin-resource/*.yml         "$STAGING_DIR/"
cp "$SCRIPT_DIR"/trinity-lance-resource/*.yml         "$STAGING_DIR/"
cp "$SCRIPT_DIR"/trinity-lance-worker-resource/*.yml  "$STAGING_DIR/"
cp "$SCRIPT_DIR"/trinity-home-resource/*.yml          "$STAGING_DIR/"
cp "$SCRIPT_DIR"/trinity-func-resource/*.yml          "$STAGING_DIR/"

# Alluneed services
cp "$SCRIPT_DIR"/alluneed-resource/*.yml              "$STAGING_DIR/"

echo ""
echo "Compiled resources in: $STAGING_DIR"
echo ""

# ── Compile + Deploy ──────────────────────────────────────────────────────────
merlin deploy \
  --input "$STAGING_DIR" \
  --ring  "$RING" \
  --region "$REGION" \
  $EXECUTE_FLAG
