#!/usr/bin/env bash
# deploy-trinity.sh
#
# Compiles and deploys all Trinity + Alluneed resources via Merlin.
#
# Usage:
#   ./deploy-trinity.sh [--ring test|staging] [--region koreacentral|eastasia] [--execute] [--all]
#
# Default: dry-run for ring=test, region=koreacentral
#
# Examples:
#   ./deploy-trinity.sh                                      # dry-run, test / koreacentral
#   ./deploy-trinity.sh --ring staging --region eastasia     # dry-run, staging / eastasia
#   ./deploy-trinity.sh --ring test --execute                # execute, test / koreacentral
#   ./deploy-trinity.sh --all --execute                      # execute all rings × regions

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

# Shared infrastructure (Redis, Postgres, ABS, AKV, GitHub SP)
cp "$SCRIPT_DIR"/shared-resource/*.yml "$STAGING_DIR/"

# Trinity shared infrastructure (LAW + ACAE, shared across all trinity services)
cp "$SCRIPT_DIR"/trinity-resource/*.yml "$STAGING_DIR/"

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

# Synapse services
cp "$SCRIPT_DIR"/synapse-resource/*.yml               "$STAGING_DIR/"

echo ""
echo "Resources staged in: $STAGING_DIR"
echo ""

# ── Deploy (compile + build .merlin/ + execute are all handled by merlin deploy) ──
if [[ "$ALL_MODE" == "true" ]]; then
  echo "=========================================="
  echo " Merlin Deploy: Trinity + Alluneed + Synapse (ALL)"
  echo " Rings:   test, staging"
  echo " Regions: koreacentral, eastasia"
  echo " Execute: ${EXECUTE_FLAG:-dry-run}"
  echo "=========================================="
  for ring in test staging; do
    for region in koreacentral eastasia; do
      echo ""
      echo "── $ring / $region ──"
      merlin deploy \
        --input "$STAGING_DIR" \
        --ring  "$ring" \
        --region "$region" \
        $EXECUTE_FLAG
    done
  done
else
  echo "=========================================="
  echo " Merlin Deploy: Trinity + Alluneed + Synapse"
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
