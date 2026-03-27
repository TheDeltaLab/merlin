#!/usr/bin/env bash
#
# Migrate all secrets from an old Azure Key Vault to a new one.
# Secret names are preserved as-is.
#
# Prerequisites:
#   - az CLI logged in (`az login`)
#   - "Key Vault Secrets User" role on the source vault (to read secrets)
#   - "Key Vault Secrets Officer" role on the target vault (to write secrets)
#
# If you don't have the required roles, ask a subscription Owner to grant them:
#   az role assignment create --assignee <your-object-id> \
#     --role "Key Vault Secrets User" \
#     --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<source-vault>
#   az role assignment create --assignee <your-object-id> \
#     --role "Key Vault Secrets Officer" \
#     --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<target-vault>
#
# Usage:
#   ./scripts/migrate-kv-secrets.sh <source-vault> <target-vault>
#
# Examples:
#   # Copy all secrets from old KV to staging KV
#   ./scripts/migrate-kv-secrets.sh delta-test-krc-akv merlinsharedstgkrcakv
#
#   # Copy all secrets from old KV to test KV
#   ./scripts/migrate-kv-secrets.sh delta-test-krc-akv merlinsharedtstkrcakv

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <source-vault> <target-vault>"
  exit 1
fi

SOURCE_VAULT="$1"
TARGET_VAULT="$2"

echo "Migrating secrets: $SOURCE_VAULT → $TARGET_VAULT"
echo ""

# Get all secret names from source vault
secrets=$(az keyvault secret list --vault-name "$SOURCE_VAULT" --query "[].name" -o tsv)

if [ -z "$secrets" ]; then
  echo "No secrets found in $SOURCE_VAULT"
  exit 0
fi

total=$(echo "$secrets" | wc -l | tr -d ' ')
count=0
failed=0

for secret in $secrets; do
  count=$((count + 1))
  printf "[%d/%d] %s ... " "$count" "$total" "$secret"

  # Read from source
  value=$(az keyvault secret show --vault-name "$SOURCE_VAULT" --name "$secret" --query "value" -o tsv 2>/dev/null) || {
    echo "FAILED (read)"
    failed=$((failed + 1))
    continue
  }

  # Write to target
  if az keyvault secret set --vault-name "$TARGET_VAULT" --name "$secret" --value "$value" -o none 2>/dev/null; then
    echo "OK"
  else
    echo "FAILED (write)"
    failed=$((failed + 1))
  fi
done

echo ""
echo "Done. $((count - failed))/$count secrets copied successfully."
if [ "$failed" -gt 0 ]; then
  echo "WARNING: $failed secret(s) failed."
  exit 1
fi
