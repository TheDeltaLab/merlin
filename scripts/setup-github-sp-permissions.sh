#!/bin/bash
set -euo pipefail

# ============================================================================
# Setup GitHub Actions SP permissions for full CI/CD deploy
#
# Prerequisites:
#   - az login with an account that has:
#     • Owner on the subscription
#     • Global Administrator (or Privileged Role Administrator) in Azure AD
#   - The SP must already exist (created by a previous `merlin deploy shared-resource`)
#
# Usage:
#   ./scripts/setup-github-sp-permissions.sh          # both rings
#   ./scripts/setup-github-sp-permissions.sh test      # test only
#   ./scripts/setup-github-sp-permissions.sh staging   # staging only
#
# All commands are idempotent — safe to re-run.
# ============================================================================

RING="${1:-all}"

setup_sp() {
    local display_name="$1"
    local ring_label="$2"

    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  Setting up: $display_name ($ring_label)"
    echo "═══════════════════════════════════════════════════════════"

    # ── 1. Resolve SP app ID ──────────────────────────────────────
    echo "→ Looking up app ID for '$display_name'..."
    APP_ID=$(az ad app list --filter "displayName eq '$display_name'" --query '[0].appId' -o tsv)
    if [ -z "$APP_ID" ]; then
        echo "✘ ERROR: SP '$display_name' not found. Run 'merlin deploy shared-resource' first."
        return 1
    fi
    echo "  App ID: $APP_ID"

    # ── 2. MS Graph API permissions ───────────────────────────────
    echo "→ Setting MS Graph API permissions (Application.ReadWrite.All, AppRoleAssignment.ReadWrite.All, Directory.Read.All)..."
    az ad app update --id "$APP_ID" --required-resource-accesses '[{
        "resourceAppId": "00000003-0000-0000-c000-000000000000",
        "resourceAccess": [
            {"id": "1bfefb4e-e0b5-418b-a88f-73c46d2cc8e9", "type": "Role"},
            {"id": "06b708a9-e830-4db3-a914-8e69da51d44f", "type": "Role"},
            {"id": "7ab1d382-f21e-4acd-a863-ba3e13f7da61", "type": "Role"}
        ]
    }]'

    # ── 3. Admin consent ──────────────────────────────────────────
    echo "→ Granting admin consent..."
    az ad app permission admin-consent --id "$APP_ID" || echo "  ⚠ Admin consent failed — may need Global Admin to approve in Azure Portal"

    # ── 4. ARM RBAC role assignments (subscription-level) ─────────
    SUBSCRIPTION_ID=$(az account show --query id -o tsv)
    echo "→ Assigning ARM roles on subscription $SUBSCRIPTION_ID..."

    declare -a ROLES=(
        "Contributor"
        "User Access Administrator"
        "AcrPush"
        "Azure Kubernetes Service Cluster User Role"
        "Azure Kubernetes Service RBAC Writer"
        "Key Vault Secrets Officer"
    )

    for role in "${ROLES[@]}"; do
        echo "  • $role"
        az role assignment create \
            --assignee "$APP_ID" \
            --role "$role" \
            --scope "/subscriptions/$SUBSCRIPTION_ID" 2>/dev/null || true
    done

    # ── 4b. ARM RBAC role assignments (resource-group scoped) ─────
    # These cover legacy resource groups that pre-date the merlin-managed
    # subscription-scope grants above. Without them, the github CI SP
    # cannot manage DNS records on the parent zone (ingress / ACA bindDnsZone)
    # nor write blobs to the legacy ABS account.
    #
    # Format: "RG_NAME:Role Name"
    declare -a RG_SCOPED_ROLES=(
        # DNS Zone Contributor on Trinity-Dev-RG — required for parent-zone
        # operations on `thebrainly.dev` (NS delegation for child zones,
        # A/CNAME/TXT records emitted by KubernetesIngress.bindDnsZone and
        # AzureContainerApp.bindDnsZone).
        "Trinity-Dev-RG:DNS Zone Contributor"
        # Storage Blob Data Contributor on Storage-Dev-RG — required for
        # data-plane writes to the legacy `brainlydevblobstorage` account.
        # Subscription-scope Contributor only covers control-plane.
        "Storage-Dev-RG:Storage Blob Data Contributor"
    )

    for entry in "${RG_SCOPED_ROLES[@]}"; do
        rg="${entry%%:*}"
        role="${entry#*:}"
        echo "  • $role on RG $rg"
        if az group show --name "$rg" >/dev/null 2>&1; then
            az role assignment create \
                --assignee "$APP_ID" \
                --role "$role" \
                --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$rg" 2>/dev/null || true
        else
            echo "    (skipped — RG '$rg' not found in subscription)"
        fi
    done

    # ── 5. Directory roles (tenant-level) ─────────────────────────
    SP_OID=$(az ad sp list --filter "appId eq '$APP_ID'" --query '[0].id' -o tsv)
    echo "→ Assigning directory roles (SP object ID: $SP_OID)..."

    # Directory Readers
    echo "  • Directory Readers"
    az rest --method post --url "https://graph.microsoft.com/v1.0/directoryRoles" \
        --headers "Content-Type=application/json" \
        --body '{"roleTemplateId":"88d8e3e3-8f55-4a1e-953a-9b9898b8876b"}' 2>/dev/null || true
    DIR_READER_ID=$(az rest --method get --url "https://graph.microsoft.com/v1.0/directoryRoles" \
        -o tsv --query "value[?roleTemplateId=='88d8e3e3-8f55-4a1e-953a-9b9898b8876b'].id | [0]")
    az rest --method post \
        --url "https://graph.microsoft.com/v1.0/directoryRoles/$DIR_READER_ID/members/\$ref" \
        --headers "Content-Type=application/json" \
        --body "{\"@odata.id\":\"https://graph.microsoft.com/v1.0/servicePrincipals/$SP_OID\"}" 2>/dev/null || true

    # Application Administrator
    echo "  • Application Administrator"
    az rest --method post --url "https://graph.microsoft.com/v1.0/directoryRoles" \
        --headers "Content-Type=application/json" \
        --body '{"roleTemplateId":"9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3"}' 2>/dev/null || true
    APP_ADMIN_ID=$(az rest --method get --url "https://graph.microsoft.com/v1.0/directoryRoles" \
        -o tsv --query "value[?roleTemplateId=='9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3'].id | [0]")
    az rest --method post \
        --url "https://graph.microsoft.com/v1.0/directoryRoles/$APP_ADMIN_ID/members/\$ref" \
        --headers "Content-Type=application/json" \
        --body "{\"@odata.id\":\"https://graph.microsoft.com/v1.0/servicePrincipals/$SP_OID\"}" 2>/dev/null || true

    echo "✔ Done: $display_name"
}

# ── Main ──────────────────────────────────────────────────────────────────────

echo "Checking Azure login..."
az account show --query '{subscription: name, user: user.name}' -o table || {
    echo "✘ Not logged in. Run 'az login' first."
    exit 1
}
echo ""

if [ "$RING" = "all" ] || [ "$RING" = "test" ]; then
    setup_sp "brainly-github-tst" "test"
fi

if [ "$RING" = "all" ] || [ "$RING" = "staging" ]; then
    setup_sp "brainly-github-stg" "staging"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ All done!"
echo ""
echo "  To verify, run:"
echo "    az role assignment list --assignee <APP_ID> --all --output table"
echo "    az rest --method get --url 'https://graph.microsoft.com/v1.0/servicePrincipals/<SP_OID>/memberOf' --query 'value[].displayName'"
echo "═══════════════════════════════════════════════════════════"
