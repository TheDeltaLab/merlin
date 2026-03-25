#!/usr/bin/env bash
# deploy-synapse.sh
#
# Compiles and deploys Synapse resources via Merlin.
#
# Usage:
#   ./deploy-synapse.sh [--ring test|staging] [--region koreacentral] [--execute] [--all]
#
# Default: dry-run for ring=test, region=koreacentral
#
# Examples:
#   ./deploy-synapse.sh                        # dry-run, test / koreacentral
#   ./deploy-synapse.sh --execute              # execute, test / koreacentral
#   ./deploy-synapse.sh --ring staging --execute
#   ./deploy-synapse.sh --all --execute        # execute all rings × regions

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RING="test"
REGION="koreacentral"
EXECUTE_FLAG=""
ALL_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ring)     RING="$2";   shift 2 ;;
    --region)   REGION="$2"; shift 2 ;;
    --execute)  EXECUTE_FLAG="--execute"; shift ;;
    --all)      ALL_MODE=true; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Build merlin from source ───────────────────────────────────────────────────
echo "🔨 Building merlin..."
(cd "$SCRIPT_DIR" && pnpm --silent build)

# ── Staging directory ─────────────────────────────────────────────────────────
STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT

cp "$SCRIPT_DIR"/synapse-resource/*.yml "$STAGING_DIR/"

echo ""
echo "Resources staged in: $STAGING_DIR"
echo ""

# ── Deploy ────────────────────────────────────────────────────────────────────
if [[ "$ALL_MODE" == "true" ]]; then
  echo "=========================================="
  echo " Merlin Deploy: Synapse (ALL)"
  echo " Rings:   test, staging"
  echo " Regions: koreacentral"
  echo " Execute: ${EXECUTE_FLAG:-dry-run}"
  echo "=========================================="
  for ring in test staging; do
    echo ""
    echo "── $ring / koreacentral ──"
    merlin deploy \
      --input "$STAGING_DIR" \
      --ring  "$ring" \
      --region koreacentral \
      $EXECUTE_FLAG
  done
else
  echo "=========================================="
  echo " Merlin Deploy: Synapse"
  echo " Ring:    ${RING}"
  echo " Region:  ${REGION}"
  echo " Execute: ${EXECUTE_FLAG:-dry-run}"
  echo "=========================================="
  merlin deploy \
    --input "$STAGING_DIR" \
    --ring  "$RING" \
    --region "$REGION" \
    $EXECUTE_FLAG
fi
