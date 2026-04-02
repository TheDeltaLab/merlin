#!/usr/bin/env bash
set -eo pipefail

##############################################################################
# setup-github-acr-secrets.sh
#
# After `merlin deploy shared-resource --execute` creates the GitHub Actions
# Service Principals (brainly-github-tst / brainly-github-stg), run this
# script to:
#
#   1. Create (or rotate) a client secret on the SP
#   2. Store the ACR credentials + SP client ID in the target GitHub repo(s)
#      as Actions secrets / variables
#
# This is needed because OIDC federated credentials cannot authenticate to
# ACR for docker push. The SP needs a client secret for `docker login`.
#
# Prerequisites:
#   - Azure CLI (`az`) logged in with permissions to manage the SP
#   - GitHub CLI (`gh`) authenticated with repo admin access
#   - The SP must already exist (created by `merlin deploy shared-resource`)
#
# Usage:
#   ./scripts/setup-github-acr-secrets.sh                  # interactive
#   ./scripts/setup-github-acr-secrets.sh --ring test       # non-interactive
#   ./scripts/setup-github-acr-secrets.sh --ring staging
#   ./scripts/setup-github-acr-secrets.sh --ring test --repos TheDeltaLab/trinity,TheDeltaLab/alluneed
#
# What gets set in each GitHub repo:
#   Secrets:
#     AKS_ACR_USERNAME   — SP appId (used as docker login username)
#     AKS_ACR_PASSWORD   — SP client secret (used as docker login password)
#   Variables:
#     AKS_ACR_NAME       — ACR name (e.g. brainlysharedacr)
##############################################################################

# ─── Defaults ────────────────────────────────────────────────────────────────

ACR_NAME="brainlysharedacr"
SECRET_DISPLAY_NAME="github-actions-acr"
SECRET_YEARS=2
DEFAULT_REPOS="TheDeltaLab/trinity,TheDeltaLab/alluneed"

# ─── Helpers ─────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}ℹ ${NC}$*"; }
ok()    { echo -e "${GREEN}✅ ${NC}$*"; }
warn()  { echo -e "${YELLOW}⚠️  ${NC}$*"; }
err()   { echo -e "${RED}❌ ${NC}$*" >&2; }

# SP display name for a given ring (must match sharedgithubsp.yml)
get_sp_name() {
  case "$1" in
    test)    echo "brainly-github-tst" ;;
    staging) echo "brainly-github-stg" ;;
    *)       echo "" ;;
  esac
}

# ─── Parse args ──────────────────────────────────────────────────────────────

RING=""
REPOS_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ring)     RING="$2";           shift 2 ;;
    --repos)    REPOS_OVERRIDE="$2"; shift 2 ;;
    --acr)      ACR_NAME="$2";       shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--ring test|staging] [--repos owner/repo,...] [--acr acrName]"
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Pre-flight checks ──────────────────────────────────────────────────────

if ! command -v az &>/dev/null; then
  err "Azure CLI (az) is not installed. Install: https://aka.ms/install-azure-cli"
  exit 1
fi

if ! command -v gh &>/dev/null; then
  err "GitHub CLI (gh) is not installed. Install: https://cli.github.com"
  exit 1
fi

if ! az account show &>/dev/null; then
  err "Not logged in to Azure CLI. Run: az login"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  err "Not logged in to GitHub CLI. Run: gh auth login"
  exit 1
fi

# ─── Interactive ring selection ──────────────────────────────────────────────

if [[ -z "$RING" ]]; then
  echo ""
  echo "Select target ring:"
  echo "  1) test    (SP: $(get_sp_name test))"
  echo "  2) staging (SP: $(get_sp_name staging))"
  echo ""
  read -rp "Enter choice [1/2]: " choice
  case "$choice" in
    1) RING="test" ;;
    2) RING="staging" ;;
    *) err "Invalid choice"; exit 1 ;;
  esac
fi

SP_DISPLAY_NAME=$(get_sp_name "$RING")

if [[ -z "$SP_DISPLAY_NAME" ]]; then
  err "Unknown ring: $RING (expected: test or staging)"
  exit 1
fi

REPOS="${REPOS_OVERRIDE:-$DEFAULT_REPOS}"

echo ""
info "Ring:         $RING"
info "SP:           $SP_DISPLAY_NAME"
info "ACR:          $ACR_NAME"
info "Target repos: $REPOS"
echo ""

# ─── Step 1: Look up SP ─────────────────────────────────────────────────────

info "Looking up Service Principal '$SP_DISPLAY_NAME'..."

SP_APP_ID=$(az ad sp list --display-name "$SP_DISPLAY_NAME" --query "[0].appId" -o tsv 2>/dev/null)

if [[ -z "$SP_APP_ID" ]]; then
  err "Service Principal '$SP_DISPLAY_NAME' not found."
  err "Run 'merlin deploy shared-resource --execute' first to create it."
  exit 1
fi

ok "Found SP: $SP_DISPLAY_NAME (appId: $SP_APP_ID)"

# ─── Step 2: Create / rotate client secret ───────────────────────────────────

info "Creating client secret (name: $SECRET_DISPLAY_NAME, expires in $SECRET_YEARS years)..."

CRED_OUTPUT=$(az ad app credential reset \
  --id "$SP_APP_ID" \
  --display-name "$SECRET_DISPLAY_NAME" \
  --years "$SECRET_YEARS" \
  -o json 2>/dev/null)

SP_PASSWORD=$(echo "$CRED_OUTPUT" | jq -r '.password')

if [[ -z "$SP_PASSWORD" || "$SP_PASSWORD" == "null" ]]; then
  err "Failed to create client secret"
  exit 1
fi

EXPIRE_DATE=$(date -v+${SECRET_YEARS}y '+%Y-%m-%d' 2>/dev/null || \
              date -d "+${SECRET_YEARS} years" '+%Y-%m-%d' 2>/dev/null || \
              echo "${SECRET_YEARS} years from now")
ok "Client secret created (expires: $EXPIRE_DATE)"

# ─── Step 3: Store in GitHub repos ──────────────────────────────────────────

IFS=',' read -ra REPO_LIST <<< "$REPOS"

for repo in "${REPO_LIST[@]}"; do
  repo="${repo// /}" # trim spaces
  echo ""
  info "Configuring GitHub repo: $repo"

  # Set secrets
  echo "$SP_APP_ID"  | gh secret set AKS_ACR_USERNAME --repo "$repo" 2>/dev/null && \
    ok "  Secret AKS_ACR_USERNAME set" || warn "  Failed to set AKS_ACR_USERNAME"

  echo "$SP_PASSWORD" | gh secret set AKS_ACR_PASSWORD --repo "$repo" 2>/dev/null && \
    ok "  Secret AKS_ACR_PASSWORD set" || warn "  Failed to set AKS_ACR_PASSWORD"

  # Set variable
  gh variable set AKS_ACR_NAME --repo "$repo" --body "$ACR_NAME" 2>/dev/null && \
    ok "  Variable AKS_ACR_NAME = $ACR_NAME" || warn "  Failed to set AKS_ACR_NAME"
done

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Done!${NC} ACR credentials configured for $RING ring."
echo ""
echo "  SP:           $SP_DISPLAY_NAME ($SP_APP_ID)"
echo "  ACR:          $ACR_NAME"
echo "  Secret name:  $SECRET_DISPLAY_NAME"
echo "  Expires:      ~$EXPIRE_DATE"
echo "  Repos:        ${REPO_LIST[*]}"
echo ""
echo "GitHub Actions workflows can now use:"
echo "  secrets.AKS_ACR_USERNAME  → docker login username"
echo "  secrets.AKS_ACR_PASSWORD  → docker login password"
echo "  vars.AKS_ACR_NAME        → ACR registry name"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
warn "Remember: when the secret expires, re-run this script to rotate it."
