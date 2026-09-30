#!/usr/bin/env bash
# Deploys sotto_proofs to devnet for the first time (14 section 4 and 5, step 2.7). Localnet deploys
# it per ledger in scripts/bootstrap-localnet.ts; mainnet is refused (G7: a verifiable build and a
# Squads upgrade authority come first).
#
# Before anything is sent it checks: the Agave CLI version, that the endpoint serves devnet (genesis
# hash), the program keypair and the upgrade authority keypair (files outside the repository, mode
# 600, the expected public keys), that the program address holds no account yet, the build (pinned
# cargo-build-sbf, SBPF v3, facts K8) with its size and SHA-256, and the cost against the authority's
# balance. --max-len is 3 times the program size rounded up to the next 10 KiB (founder, step 2.7),
# so later upgrades fit. Without --yes it prints the plan and stops. After the deploy it reads the
# program back (solana program show and dump) and checks that the deployed bytes are the build's.
#
# The CLI funds the temporary buffer with the rent of the program data account, and the loader returns
# the buffer's lamports to the payer before paying for the program data account, so the payer needs
# the program data rent, the program account rent and the fees, no more (Q-17, facts N1).
#
# Usage: scripts/deploy-program.sh --cluster devnet [--url https://api.devnet.solana.com] [--yes]
# The public devnet endpoint is the default: the CLI may print its URL, so no private endpoint is used.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQUIRED_CLI_VERSION="4.2.2"
DEVNET_GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
PROGRAM_KEYPAIR="$HOME/.config/solana/sotto/sotto-proofs-devnet.json"
PROGRAM_ID="4rMKgJWgawaTTdUxaudUXthEExnRZ7AvFvqzsoEAr9jd"
# Wallet A, the devnet upgrade authority and payer (D-16).
AUTHORITY_KEYPAIR="$HOME/.config/solana/sotto/wallet-a.json"
AUTHORITY="7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L"
SO="$ROOT/target/deploy/sotto_proofs.so"
KIB10=10240

cluster=""
url="https://api.devnet.solana.com"
yes=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster) cluster="$2"; shift 2 ;;
    --url) url="$2"; shift 2 ;;
    --yes) yes=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ "$cluster" != "devnet" ]]; then
  echo "error: only --cluster devnet is supported (localnet: scripts/bootstrap-localnet.ts; mainnet after G7)" >&2
  exit 2
fi

installed="$(solana --version | awk '{print $2}')"
[[ "$installed" == "$REQUIRED_CLI_VERSION" ]] || { echo "error: solana-cli $REQUIRED_CLI_VERSION required, found $installed" >&2; exit 1; }
[[ "$(solana genesis-hash --url "$url")" == "$DEVNET_GENESIS" ]] || { echo "error: $url does not serve devnet" >&2; exit 1; }

for file in "$PROGRAM_KEYPAIR" "$AUTHORITY_KEYPAIR"; do
  [[ -f "$file" ]] || { echo "error: missing $file" >&2; exit 1; }
  [[ "$(stat -f %Lp "$file")" == "600" ]] || { echo "error: $file must have mode 600" >&2; exit 1; }
done
[[ "$(solana-keygen pubkey "$PROGRAM_KEYPAIR")" == "$PROGRAM_ID" ]] || { echo "error: the program keypair is not $PROGRAM_ID" >&2; exit 1; }
[[ "$(solana-keygen pubkey "$AUTHORITY_KEYPAIR")" == "$AUTHORITY" ]] || { echo "error: the authority keypair is not $AUTHORITY" >&2; exit 1; }
if solana account "$PROGRAM_ID" --url "$url" >/dev/null 2>&1; then
  echo "error: $PROGRAM_ID already exists on devnet; this script only makes the first deployment" >&2
  exit 1
fi

cargo-build-sbf --manifest-path "$ROOT/programs/sotto_proofs/Cargo.toml" --arch v3 -- --locked
size="$(wc -c <"$SO" | tr -d ' ')"
hash="$(shasum -a 256 "$SO" | awk '{print $1}')"
max_len=$(( (3 * size + KIB10 - 1) / KIB10 * KIB10 ))
program_data_rent="$(solana rent $((max_len + 45)) --lamports --url "$url" | awk '/Rent-exempt minimum/ {print $3}')"
program_rent="$(solana rent 36 --lamports --url "$url" | awk '/Rent-exempt minimum/ {print $3}')"
# One signature per buffer write (about 1000 bytes each) plus the buffer and deploy transactions,
# 5000 lamports each; measured on localnet: 48 signatures for 44360 bytes.
fees=$(( ( (size + 999) / 1000 + 4 ) * 5000 ))
needed=$(( program_data_rent + program_rent + fees ))
balance="$(solana balance "$AUTHORITY" --lamports --url "$url" | awk '{print $1}')"

echo "program id:        $PROGRAM_ID"
echo "upgrade authority: $AUTHORITY"
echo "build:             $size bytes, sha256 $hash"
echo "max-len:           $max_len bytes"
echo "program data rent: $program_data_rent lamports ($((max_len + 45)) bytes)"
echo "program rent:      $program_rent lamports (36 bytes)"
echo "fees (estimate):   $fees lamports"
echo "needed:            $needed lamports; authority balance $balance lamports"
(( balance > needed )) || { echo "error: the authority holds too little SOL" >&2; exit 1; }
if [[ -z "$yes" ]]; then
  echo "dry run: pass --yes to deploy"
  exit 0
fi

solana program deploy "$SO" \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$AUTHORITY_KEYPAIR" \
  --upgrade-authority "$AUTHORITY_KEYPAIR" \
  --max-len "$max_len" \
  --url "$url"

# Read back: the authority, the length, and the deployed bytes (the build, then zeros to max-len).
show="$(solana program show "$PROGRAM_ID" --url "$url")"
echo "$show"
grep -q "Authority: $AUTHORITY" <<<"$show" || { echo "error: unexpected upgrade authority" >&2; exit 1; }
grep -q "Data Length: $max_len " <<<"$show" || { echo "error: unexpected data length" >&2; exit 1; }
dump="$(mktemp)"
trap 'rm -f "$dump"' EXIT
solana program dump "$PROGRAM_ID" "$dump" --url "$url" >/dev/null
deployed="$(head -c "$size" "$dump" | shasum -a 256 | awk '{print $1}')"
padding="$(tail -c +$((size + 1)) "$dump" | tr -d '\000' | wc -c | tr -d ' ')"
echo "deployed sha256:   $deployed (dump $(wc -c <"$dump" | tr -d ' ') bytes, $padding non zero bytes after the build)"
[[ "$deployed" == "$hash" && "$padding" == "0" ]] || { echo "error: the deployed bytes are not the build" >&2; exit 1; }
echo "DEPLOY OK: $PROGRAM_ID, sha256 $hash, $size bytes, max-len $max_len"
