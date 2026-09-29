#!/usr/bin/env bash
# Starts a local validator with the confidential stack active (docs/VERSIONS.md, localnet validator command).
# - Token-2022 is cloned from devnet: the Token-2022 bundled with solana-test-validator 4.2.2 lacks zk-ops
#   (facts H3).
# - Token Wrap is the Sotto devnet test deployment (D-01), fetched and hash checked by fetch-token-wrap.sh,
#   loaded at the same program ID as on devnet.
# - The Solana Attestation Service program is cloned from devnet (facts E3), for the SAS bootstrap and
#   the worker's localnet test.
# - The SPL Record program is cloned from devnet (step 1.9): a confidential transfer in a version 0
#   transaction stages its range proof in a record account (06 section 5).
# - All feature gates are active at genesis, so the ZK ElGamal Proof program is enabled (facts B6).
# - The ledger keeps 200 000 shreds instead of the default 10 000 (step 2.6): with the default the
#   cleanup keeps about 50 slots, under half a minute, so getSignaturesForAddress soon refuses an
#   indexer cursor it purged (facts M5). The indexer copes with that too; about 9 minutes of ledger
#   keep the e2e runs reading the normal path.
# Runs in the foreground. Extra arguments are passed to solana-test-validator.
set -euo pipefail

REQUIRED_VALIDATOR_VERSION="4.2.2"
DEVNET_URL="https://api.devnet.solana.com"
TOKEN_2022_PROGRAM="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
SAS_PROGRAM="22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"
RECORD_PROGRAM="recr1L3PCGKLbckBqMNcJhuuyU1zgo8nBhfLVsJNwr5"
TOKEN_WRAP_PROGRAM="EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn"
# Upgrade authority recorded for the devnet deployment (wallet A, public key only).
TOKEN_WRAP_UPGRADE_AUTHORITY="7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER="$ROOT/.localnet/ledger"
TOKEN_WRAP_SO="$ROOT/.cache/token-wrap/spl_token_wrap.so"

installed="$(solana-test-validator --version | awk '{print $2}')"
if [[ "$installed" != "$REQUIRED_VALIDATOR_VERSION" ]]; then
  echo "error: solana-test-validator $REQUIRED_VALIDATOR_VERSION required, found $installed" >&2
  exit 1
fi

"$ROOT/scripts/fetch-token-wrap.sh" --url "$DEVNET_URL"
mkdir -p "$(dirname "$LEDGER")"

exec solana-test-validator --reset --quiet \
  --ledger "$LEDGER" \
  --limit-ledger-size 200000 \
  --url "$DEVNET_URL" \
  --clone-upgradeable-program "$TOKEN_2022_PROGRAM" \
  --clone-upgradeable-program "$SAS_PROGRAM" \
  --clone-upgradeable-program "$RECORD_PROGRAM" \
  --upgradeable-program "$TOKEN_WRAP_PROGRAM" "$TOKEN_WRAP_SO" "$TOKEN_WRAP_UPGRADE_AUTHORITY" \
  "$@"
