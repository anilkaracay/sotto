#!/usr/bin/env bash
# Fetches the Sotto devnet test deployment of Token Wrap (D-01) for localnet and CI.
# Dumps the deployed program from devnet (read only) into an ignored path and verifies its SHA-256
# against the recorded build (docs/VERSIONS.md). Fails on any mismatch.
#
# Usage: scripts/fetch-token-wrap.sh [--url <devnet rpc url>]
set -euo pipefail

PROGRAM_ID="EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn"
EXPECTED_SHA256="533a3023040ee2a70f7687dcb1086462c5acd5960ad805327b708a02013eb22a"
URL="https://api.devnet.solana.com"
if [[ "${1:-}" == "--url" ]]; then
  URL="${2:?--url needs a value}"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/.cache/token-wrap"
OUT="$OUT_DIR/spl_token_wrap.so"
TMP="$OUT.download"

mkdir -p "$OUT_DIR"
rm -f "$TMP"
solana program dump "$PROGRAM_ID" "$TMP" --url "$URL" >/dev/null
actual="$(shasum -a 256 "$TMP" | awk '{print $1}')"
if [[ "$actual" != "$EXPECTED_SHA256" ]]; then
  rm -f "$TMP"
  echo "ERROR: Token Wrap program $PROGRAM_ID on devnet does not match the recorded build." >&2
  echo "ERROR: expected $EXPECTED_SHA256" >&2
  echo "ERROR: got      $actual" >&2
  exit 1
fi
mv "$TMP" "$OUT"
echo "$OUT"
echo "sha256 ok: $actual"
