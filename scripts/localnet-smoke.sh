#!/usr/bin/env bash
# Confidential transfer smoke test against a running localnet (scripts/localnet.sh).
# Same flow as Gate G1 task 7 (docs/VERIFICATION-LOG.md): create a Token-2022 mint with confidential
# transfers, create and configure two accounts, mint, deposit, apply, transfer confidentially, apply on
# the receiver, withdraw. Uses throwaway keypairs in .localnet/smoke (ignored). Exits non zero on any
# failure.
#
# Usage: scripts/localnet-smoke.sh [--url <rpc url>]
set -euo pipefail

REQUIRED_SPL_TOKEN_VERSION="5.6.1"
TOKEN_2022_PROGRAM="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
TOKEN_WRAP_PROGRAM="EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn"
SAS_PROGRAM="22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"
ZK_GATES=(
  zkhiy5oLowR7HY4zogXjCjeMXyruLqBwSWH21qcFtnv # zk_elgamal_proof_program_enabled
  zkdoVwnSFnSLtGJG7irJPEYUpmb4i7sGMGcnN6T9rnC # disable_zk_elgamal_proof_program
  zkexuyPRdyTVbZqEAREueqL2xvvoBhRgth9xGSc1tMN # reenable_zk_elgamal_proof_program
)
URL="http://127.0.0.1:8899"
if [[ "${1:-}" == "--url" ]]; then
  URL="${2:?--url needs a value}"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYS="$ROOT/.localnet/smoke"
STEP="setup"
trap 'echo "SMOKE FAILED at step: $STEP" >&2' ERR

step() {
  STEP="$1"
  echo "== $STEP"
}

installed="$(spl-token --version | awk '{print $2}')"
if [[ "$installed" != "$REQUIRED_SPL_TOKEN_VERSION" ]]; then
  echo "error: spl-token $REQUIRED_SPL_TOKEN_VERSION required, found $installed" >&2
  exit 1
fi

step "wait for validator"
for _ in $(seq 1 60); do
  if solana cluster-version --url "$URL" >/dev/null 2>&1; then break; fi
  sleep 1
done
solana cluster-version --url "$URL"

step "check feature gates and programs"
for gate in "${ZK_GATES[@]}"; do
  status="$(solana feature status "$gate" --url "$URL" --output json-compact | grep -o '"status":"[a-z]*"' | head -1)"
  if [[ "$status" != '"status":"active"' ]]; then
    echo "error: feature $gate is not active ($status)" >&2
    exit 1
  fi
done
solana program show "$TOKEN_WRAP_PROGRAM" --url "$URL" >/dev/null
solana program show "$TOKEN_2022_PROGRAM" --url "$URL" >/dev/null
solana program show "$SAS_PROGRAM" --url "$URL" >/dev/null

step "create throwaway keypairs and fund them"
rm -rf "$KEYS"
mkdir -p "$KEYS"
for name in a b mint; do
  solana-keygen new --no-bip39-passphrase --silent --force -o "$KEYS/$name.json" >/dev/null
done
A="$(solana-keygen pubkey "$KEYS/a.json")"
B="$(solana-keygen pubkey "$KEYS/b.json")"
MINT="$(solana-keygen pubkey "$KEYS/mint.json")"
solana airdrop 10 "$A" --url "$URL" >/dev/null
solana airdrop 10 "$B" --url "$URL" >/dev/null

T=(spl-token --url "$URL")

step "create mint with confidential transfers (auto approve)"
"${T[@]}" --program-id "$TOKEN_2022_PROGRAM" create-token --enable-confidential-transfers auto \
  --decimals 6 --fee-payer "$KEYS/a.json" --mint-authority "$A" "$KEYS/mint.json" >/dev/null

step "create accounts A and B"
"${T[@]}" create-account "$MINT" --owner "$A" --fee-payer "$KEYS/a.json" --program-id "$TOKEN_2022_PROGRAM" >/dev/null
"${T[@]}" create-account "$MINT" --owner "$B" --fee-payer "$KEYS/b.json" --program-id "$TOKEN_2022_PROGRAM" >/dev/null
ATA_A="$("${T[@]}" address --token "$MINT" --owner "$A" --program-id "$TOKEN_2022_PROGRAM" --verbose | awk '/Associated token address/ {print $4}')"
ATA_B="$("${T[@]}" address --token "$MINT" --owner "$B" --program-id "$TOKEN_2022_PROGRAM" --verbose | awk '/Associated token address/ {print $4}')"

step "configure A and B for confidential transfers"
"${T[@]}" configure-confidential-transfer-account "$MINT" --owner "$KEYS/a.json" --fee-payer "$KEYS/a.json" >/dev/null
"${T[@]}" configure-confidential-transfer-account "$MINT" --owner "$KEYS/b.json" --fee-payer "$KEYS/b.json" >/dev/null

step "mint 100 to A"
"${T[@]}" mint "$MINT" 100 "$ATA_A" --fee-payer "$KEYS/a.json" --mint-authority "$KEYS/a.json" >/dev/null

step "deposit 50 to confidential on A"
"${T[@]}" deposit-confidential-tokens "$MINT" 50 --address "$ATA_A" --owner "$KEYS/a.json" --fee-payer "$KEYS/a.json" >/dev/null

step "apply pending on A"
"${T[@]}" apply-pending-balance "$MINT" --address "$ATA_A" --owner "$KEYS/a.json" --fee-payer "$KEYS/a.json" >/dev/null

step "confidential transfer 20 from A to B"
"${T[@]}" transfer "$MINT" 20 "$ATA_B" --confidential --owner "$KEYS/a.json" --fee-payer "$KEYS/a.json" >/dev/null

step "apply pending on B"
"${T[@]}" apply-pending-balance "$MINT" --address "$ATA_B" --owner "$KEYS/b.json" --fee-payer "$KEYS/b.json" >/dev/null

step "withdraw 20 on B"
"${T[@]}" withdraw-confidential-tokens "$MINT" 20 --address "$ATA_B" --owner "$KEYS/b.json" --fee-payer "$KEYS/b.json" >/dev/null

step "check public balances"
balance_a="$("${T[@]}" balance --address "$ATA_A")"
balance_b="$("${T[@]}" balance --address "$ATA_B")"
if [[ "$balance_a" != "50" || "$balance_b" != "20" ]]; then
  echo "error: expected public balances A 50 and B 20, got A $balance_a and B $balance_b" >&2
  exit 1
fi

echo "SMOKE PASSED: mint $MINT, A $balance_a, B $balance_b"
