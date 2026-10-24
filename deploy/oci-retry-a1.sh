#!/usr/bin/env bash
# ============================================================================
# Keep trying to create an Always Free Ampere A1 VM until Oracle has capacity.
# Run from Git Bash on your PC (needs OCI CLI configured: `oci setup config`).
#
#   bash deploy/oci-retry-a1.sh
#
# Only SUBNET_ID needs to be filled in; everything else is looked up or has a
# sensible default. Stops on success or on any error other than "no capacity".
# ============================================================================
set -u

# ── Fill in ───────────────────────────────────────────────────────────────────
SUBNET_ID=""                                   # Networking → VCN → subnet → OCID
SSH_PUBLIC_KEY="$HOME/.ssh/oracle_vm.pub"      # see guide: ssh-keygen -y -f key > key.pub

# ── Defaults (change if you like) ────────────────────────────────────────────
OCPUS=2                  # 1–4 (free limit: 4 OCPU / 24 GB in total)
MEMORY_GB=12             # 6 GB per OCPU is the usual ratio
BOOT_GB=100              # free up to 200 GB in total
NAME="wbpsc-vm"
UBUNTU_VERSION="22.04"
INTERVAL=90              # seconds between attempts

# ── Lookups ───────────────────────────────────────────────────────────────────
[ -n "$SUBNET_ID" ] || { echo "Set SUBNET_ID at the top of this script first."; exit 1; }
[ -f "$SSH_PUBLIC_KEY" ] || { echo "Public key not found: $SSH_PUBLIC_KEY"; exit 1; }

TENANCY_ID=$(awk -F= '/^tenancy/ {gsub(/ /,"",$2); print $2; exit}' "$HOME/.oci/config")
COMPARTMENT_ID="${COMPARTMENT_ID:-$TENANCY_ID}"

AD=$(oci iam availability-domain list --compartment-id "$TENANCY_ID" \
  --query 'data[0].name' --raw-output) || { echo "OCI CLI not configured (run: oci setup config)"; exit 1; }

IMAGE_ID=$(oci compute image list --compartment-id "$COMPARTMENT_ID" \
  --operating-system "Canonical Ubuntu" --operating-system-version "$UBUNTU_VERSION" \
  --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)
[ -n "$IMAGE_ID" ] || { echo "No Ubuntu $UBUNTU_VERSION ARM image found"; exit 1; }

echo "Availability domain: $AD"
echo "Image: Ubuntu $UBUNTU_VERSION (aarch64)  Shape: ${OCPUS} OCPU / ${MEMORY_GB} GB"
echo "Retrying every ${INTERVAL}s — press Ctrl+C to stop."
echo

# ── Retry loop ───────────────────────────────────────────────────────────────
attempt=0
while true; do
  attempt=$((attempt + 1))
  out=$(oci compute instance launch \
    --compartment-id "$COMPARTMENT_ID" \
    --availability-domain "$AD" \
    --shape VM.Standard.A1.Flex \
    --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY_GB}" \
    --image-id "$IMAGE_ID" \
    --subnet-id "$SUBNET_ID" \
    --assign-public-ip true \
    --boot-volume-size-in-gbs "$BOOT_GB" \
    --display-name "$NAME" \
    --ssh-authorized-keys-file "$SSH_PUBLIC_KEY" 2>&1)

  if echo "$out" | grep -q '"lifecycle-state"'; then
    echo "$(date '+%F %T') SUCCESS on attempt $attempt — the VM is being created."
    echo "Open Oracle Console → Compute → Instances to see its public IP."
    exit 0
  elif echo "$out" | grep -qiE 'out of (host )?capacity'; then
    echo "$(date '+%F %T') attempt $attempt: no capacity yet"
    sleep "$INTERVAL"
  elif echo "$out" | grep -qi 'TooManyRequests'; then
    echo "$(date '+%F %T') attempt $attempt: rate-limited, waiting longer"
    sleep $((INTERVAL * 3))
  else
    echo "$(date '+%F %T') attempt $attempt failed with an unexpected error:"
    echo "$out"
    exit 1
  fi
done
