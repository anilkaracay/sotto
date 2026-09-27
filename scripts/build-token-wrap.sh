#!/usr/bin/env bash
# Builds the Sotto devnet test deployment of Token Wrap from source, for audit and redeploys, or with
# --cli its command line tool, patched to address that deployment (for example to unwrap devnet wUSDC,
# /app/recovery). Localnet and CI do not use this script: they fetch the deployed program
# (scripts/fetch-token-wrap.sh).
#
# Both modes download spl-token-wrap 1.0.0 from crates.io, verify the crate checksum and apply the one
# line declare_id patch (vendor/token-wrap/declare-id.patch).
# - Default: build the program with cargo-build-sbf 4.1.0, print its SHA-256 and compare it with the
#   recorded value (docs/VERSIONS.md).
# - --cli: download spl-token-wrap-cli 2.0.0, verify its checksum, point its spl-token-wrap dependency
#   at the patched source (Cargo.toml path, and the lockfile entry without its registry source and
#   checksum, so the build stays --locked), build the binary spl-token-wrap with cargo 1.98.1 and check
#   that it derives the devnet wUSDC mint of the Sotto deployment (facts C8, F1).
#
# Usage: scripts/build-token-wrap.sh [--cli]
set -euo pipefail

CRATE_VERSION="1.0.0"
CRATE_SHA256="fedeedf8417f86136fa93df58a62793f11a9c7d692bf413106db06437b0a8d60"
CARGO_BUILD_SBF_VERSION="4.1.0"
RECORDED_SO_SHA256="533a3023040ee2a70f7687dcb1086462c5acd5960ad805327b708a02013eb22a"
CLI_CRATE_VERSION="2.0.0"
CLI_CRATE_SHA256="001a5dc00c23fad0054e58b8cfd3c05be487100779d8a596d5427321c15b13c2"
CARGO_VERSION="1.98.1"
DEVNET_USDC_MINT="4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
DEVNET_WUSDC_MINT="AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd"
TOKEN_2022_PROGRAM="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

MODE="program"
case "${1:-}" in
  "") ;;
  --cli) MODE="cli" ;;
  *)
    echo "usage: scripts/build-token-wrap.sh [--cli]" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_FILE="$ROOT/vendor/token-wrap/declare-id.patch"
if [[ "$MODE" == "program" ]]; then
  WORK_DIR="$ROOT/.cache/token-wrap/build"
else
  WORK_DIR="$ROOT/.cache/token-wrap/cli"
fi
SRC_DIR="$WORK_DIR/spl-token-wrap-$CRATE_VERSION"

sha256() { shasum -a 256 "$1" | awk '{print $1}'; }

# Downloads a crate from crates.io into WORK_DIR and fails unless its SHA-256 matches. The extracted
# crate gets an empty [workspace] table, which keeps it out of the repository's Cargo workspace
# (Cargo.toml at the root) without changing what is compiled.
fetch_crate() {
  local name="$1" version="$2" expected="$3"
  local file="$WORK_DIR/$name-$version.crate"
  curl -sSfL "https://static.crates.io/crates/$name/$name-$version.crate" -o "$file"
  local actual
  actual="$(sha256 "$file")"
  if [[ "$actual" != "$expected" ]]; then
    echo "error: $name $version crate checksum mismatch: expected $expected, got $actual" >&2
    exit 1
  fi
  echo "$name $version crate checksum ok: $actual"
  tar xzf "$file" -C "$WORK_DIR"
  printf '\n[workspace]\n' >>"$WORK_DIR/$name-$version/Cargo.toml"
}

if [[ "$MODE" == "program" ]]; then
  installed="$(cargo-build-sbf --version | awk 'NR==1 {print $2}')"
  if [[ "$installed" != "$CARGO_BUILD_SBF_VERSION" ]]; then
    echo "error: cargo-build-sbf $CARGO_BUILD_SBF_VERSION required, found $installed" >&2
    exit 1
  fi
else
  installed="$(cargo --version | awk '{print $2}')"
  if [[ "$installed" != "$CARGO_VERSION" ]]; then
    echo "error: cargo $CARGO_VERSION required, found $installed" >&2
    exit 1
  fi
fi

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
fetch_crate spl-token-wrap "$CRATE_VERSION" "$CRATE_SHA256"
(cd "$SRC_DIR" && patch -p1 --forward < "$PATCH_FILE")

if [[ "$MODE" == "program" ]]; then
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
  exit 0
fi

fetch_crate spl-token-wrap-cli "$CLI_CRATE_VERSION" "$CLI_CRATE_SHA256"
CLI_DIR="$WORK_DIR/spl-token-wrap-cli-$CLI_CRATE_VERSION"
python3 - "$CLI_DIR" "$SRC_DIR" <<'PY'
import pathlib, re, sys

cli, src = pathlib.Path(sys.argv[1]), sys.argv[2]
toml = cli / "Cargo.toml"
text = toml.read_text()
header = "[dependencies.spl-token-wrap]\n"
if text.count(header) != 1:
    sys.exit("error: expected one [dependencies.spl-token-wrap] table in Cargo.toml")
toml.write_text(text.replace(header, header + f'path = "{src}"\n'))

lock = cli / "Cargo.lock"
blocks = lock.read_text().split("\n\n")
changed = 0
for i, block in enumerate(blocks):
    if block.startswith("[[package]]\nname = \"spl-token-wrap\"\n"):
        blocks[i] = "\n".join(
            line for line in block.split("\n") if not re.match(r"(source|checksum) = ", line)
        )
        changed += 1
if changed != 1:
    sys.exit("error: expected one spl-token-wrap entry in Cargo.lock")
lock.write_text("\n\n".join(blocks))
PY
(cd "$CLI_DIR" && CARGO_TARGET_DIR="$WORK_DIR/target" cargo build --release --locked --bin spl-token-wrap)

bin="$WORK_DIR/target/release/spl-token-wrap"
echo "cli:     $bin ($("$bin" --version))"
echo "sha256:  $(sha256 "$bin")"
pdas="$("$bin" find-pdas "$DEVNET_USDC_MINT" "$TOKEN_2022_PROGRAM")"
if ! grep -q "$DEVNET_WUSDC_MINT" <<<"$pdas"; then
  echo "error: the built CLI does not derive the devnet wUSDC mint $DEVNET_WUSDC_MINT:" >&2
  echo "$pdas" >&2
  exit 1
fi
echo "derives the devnet wUSDC mint $DEVNET_WUSDC_MINT of the Sotto deployment"
