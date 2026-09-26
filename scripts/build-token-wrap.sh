#!/usr/bin/env bash
# Builds the Sotto devnet test deployment of Token Wrap from source, for audit and redeploys.
# Localnet and CI do not use this script: they fetch the deployed program (scripts/fetch-token-wrap.sh).
#
# Steps: download spl-token-wrap 1.0.0 from crates.io, verify the crate checksum, apply the one line
# declare_id patch (vendor/token-wrap/declare-id.patch), build with cargo-build-sbf 4.1.0, print the
# SHA-256 of the program and compare it with the recorded value (docs/VERSIONS.md).
set -euo pipefail

CRATE_VERSION="1.0.0"
CRATE_SHA256="fedeedf8417f86136fa93df58a62793f11a9c7d692bf413106db06437b0a8d60"
CARGO_BUILD_SBF_VERSION="4.1.0"
RECORDED_SO_SHA256="533a3023040ee2a70f7687dcb1086462c5acd5960ad805327b708a02013eb22a"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_FILE="$ROOT/vendor/token-wrap/declare-id.patch"
WORK_DIR="$ROOT/.cache/token-wrap/build"
CRATE_FILE="$WORK_DIR/spl-token-wrap-$CRATE_VERSION.crate"
SRC_DIR="$WORK_DIR/spl-token-wrap-$CRATE_VERSION"

sha256() { shasum -a 256 "$1" | awk '{print $1}'; }

installed="$(cargo-build-sbf --version | awk 'NR==1 {print $2}')"
if [[ "$installed" != "$CARGO_BUILD_SBF_VERSION" ]]; then
  echo "error: cargo-build-sbf $CARGO_BUILD_SBF_VERSION required, found $installed" >&2
  exit 1
fi

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
curl -sSfL "https://static.crates.io/crates/spl-token-wrap/spl-token-wrap-$CRATE_VERSION.crate" -o "$CRATE_FILE"
actual="$(sha256 "$CRATE_FILE")"
if [[ "$actual" != "$CRATE_SHA256" ]]; then
  echo "error: crate checksum mismatch: expected $CRATE_SHA256, got $actual" >&2
  exit 1
fi
echo "crate checksum ok: $actual"

tar xzf "$CRATE_FILE" -C "$WORK_DIR"
(cd "$SRC_DIR" && patch -p1 --forward < "$PATCH_FILE")
(cd "$SRC_DIR" && cargo-build-sbf -- --locked)

so="$SRC_DIR/target/deploy/spl_token_wrap.so"
so_sha="$(sha256 "$so")"
echo "program: $so"
echo "sha256:  $so_sha"
if [[ "$so_sha" != "$RECORDED_SO_SHA256" ]]; then
  echo "error: SHA-256 differs from the recorded devnet build $RECORDED_SO_SHA256" >&2
  exit 1
fi
echo "matches the recorded devnet build"
