#!/usr/bin/env bash
# Local CI (D-25): runs the same four jobs as .github/workflows/ci.yml, in the same order, on this
# machine: node, program, localnet, checks. Stops at the first failure and prints a summary table.
# Compatible with the bash 3.2 that ships with macOS.
#
# Usage: pnpm ci:local   (or scripts/ci-local.sh)
set -uo pipefail

AGAVE_VERSION="4.2.2"
CARGO_BUILD_SBF_VERSION="4.1.0"
NODE_VERSION="$(cat "$(dirname "$0")/../.node-version")"
PNPM_VERSION="12.6.0"
GITLEAKS_VERSION="8.30.1"
RPC_URL_LOCAL="http://127.0.0.1:8899"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
LOG_DIR="$ROOT/.localnet/ci-local"
mkdir -p "$LOG_DIR"

JOBS=(node program localnet checks)
RESULTS=()
DURATIONS=()
VALIDATOR_PID=""

# Pinned gitleaks release tarball checksums (from gitleaks_8.30.1_checksums.txt).
gitleaks_expected_sha() {
  case "$1" in
    darwin_arm64) echo "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5" ;;
    darwin_x64) echo "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709" ;;
    linux_x64) echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb" ;;
    *) echo "" ;;
  esac
}

sha256() { shasum -a 256 "$1" | awk '{print $1}'; }

run() {
  echo "+ $*"
  "$@"
}

require_version() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "error: $label $expected required, found $actual" >&2
    return 1
  fi
  echo "$label $actual"
}

stop_validator() {
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    kill "$VALIDATOR_PID" 2>/dev/null
    wait "$VALIDATOR_PID" 2>/dev/null
  fi
  # localnet.sh execs the validator, so the PID above is the validator; this also covers a leftover.
  pkill -f "solana-test-validator --reset --quiet --ledger $ROOT/.localnet/ledger" 2>/dev/null
  VALIDATOR_PID=""
}

job_node() {
  require_version "node" "$(node --version | sed 's/^v//')" "$NODE_VERSION" &&
    require_version "pnpm" "$(pnpm --version)" "$PNPM_VERSION" &&
    run pnpm install --frozen-lockfile &&
    run pnpm lint &&
    run pnpm typecheck &&
    run pnpm test &&
    run pnpm build
}

job_program() {
  require_version "solana-cli" "$(solana --version | awk '{print $2}')" "$AGAVE_VERSION" &&
    require_version "cargo-build-sbf" "$(cargo-build-sbf --version | awk 'NR==1 {print $2}')" "$CARGO_BUILD_SBF_VERSION" &&
    run cargo-build-sbf --manifest-path programs/sotto_proofs/Cargo.toml -- --locked &&
    run cargo test --locked -p sotto_proofs
}

job_localnet() {
  if curl -sf -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC_URL_LOCAL" >/dev/null 2>&1; then
    echo "error: a validator is already listening on $RPC_URL_LOCAL; stop it first" >&2
    return 1
  fi
  run scripts/fetch-token-wrap.sh || return 1
  echo "+ scripts/localnet.sh (background, log .localnet/ci-local/localnet.log)"
  scripts/localnet.sh >"$LOG_DIR/localnet.log" 2>&1 &
  VALIDATOR_PID=$!
  local healthy=""
  for _ in $(seq 1 120); do
    if curl -sf -X POST -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC_URL_LOCAL" | grep -q '"ok"'; then
      healthy="yes"
      break
    fi
    if ! kill -0 "$VALIDATOR_PID" 2>/dev/null; then break; fi
    sleep 2
  done
  if [[ -z "$healthy" ]]; then
    echo "error: validator did not become healthy; see .localnet/ci-local/localnet.log" >&2
    tail -20 "$LOG_DIR/localnet.log" >&2
    stop_validator
    return 1
  fi
  echo "validator healthy"
  local status=0
  run scripts/localnet-smoke.sh || status=1
  stop_validator
  if [[ "$status" -eq 0 ]]; then
    rm -rf "$ROOT/.localnet/ledger" "$ROOT/.localnet/smoke"
    echo "cleaned up ledger and smoke keypairs"
  else
    echo "kept .localnet/ledger and .localnet/ci-local/localnet.log for inspection" >&2
  fi
  return "$status"
}

install_gitleaks() {
  local os arch platform expected dir tarball base
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    arm64 | aarch64) arch="arm64" ;;
    x86_64) arch="x64" ;;
  esac
  platform="${os}_${arch}"
  expected="$(gitleaks_expected_sha "$platform")"
  if [[ -z "$expected" ]]; then
    echo "error: no pinned gitleaks checksum for $platform" >&2
    return 1
  fi
  dir="$ROOT/.cache/gitleaks/$GITLEAKS_VERSION"
  tarball="gitleaks_${GITLEAKS_VERSION}_${platform}.tar.gz"
  base="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}"
  mkdir -p "$dir"
  if [[ ! -f "$dir/$tarball" ]] || [[ "$(sha256 "$dir/$tarball")" != "$expected" ]]; then
    curl -sSfL -o "$dir/$tarball" "$base/$tarball" || return 1
  fi
  curl -sSfL -o "$dir/checksums.txt" "$base/gitleaks_${GITLEAKS_VERSION}_checksums.txt" || return 1
  local actual listed
  actual="$(sha256 "$dir/$tarball")"
  listed="$(awk -v f="$tarball" '$2 == f {print $1}' "$dir/checksums.txt")"
  if [[ "$actual" != "$expected" || "$actual" != "$listed" ]]; then
    echo "error: gitleaks tarball checksum mismatch (got $actual, pinned $expected, listed $listed)" >&2
    return 1
  fi
  echo "gitleaks tarball sha256 ok: $actual"
  tar xzf "$dir/$tarball" -C "$dir" gitleaks || return 1
  GITLEAKS="$dir/gitleaks"
}

job_checks() {
  run python3 scripts/checks/no-dashes.py HEAD &&
    run python3 scripts/checks/ac-manifest.py &&
    install_gitleaks &&
    run "$GITLEAKS" git --redact --no-banner --config .gitleaks.toml --log-opts="--all" . &&
    run scripts/checks/no-zk-token-proof.sh
}

print_summary() {
  echo
  echo "ci:local summary ($(git rev-parse --short HEAD), $(date -u '+%Y-%m-%d %H:%M:%S UTC'))"
  printf '%-10s %-8s %s\n' "job" "result" "seconds"
  local i
  for i in "${!JOBS[@]}"; do
    printf '%-10s %-8s %s\n' "${JOBS[$i]}" "${RESULTS[$i]:-not run}" "${DURATIONS[$i]:-}"
  done
}

on_exit() {
  stop_validator
  print_summary
}
trap on_exit EXIT
trap 'exit 130' INT TERM

for i in "${!JOBS[@]}"; do
  job="${JOBS[$i]}"
  echo
  echo "=== job: $job"
  start=$(date +%s)
  if "job_$job" 2>&1 | tee "$LOG_DIR/$job.log"; then
    RESULTS[$i]="pass"
    DURATIONS[$i]=$(($(date +%s) - start))
  else
    RESULTS[$i]="FAIL"
    DURATIONS[$i]=$(($(date +%s) - start))
    echo "job $job failed; log: .localnet/ci-local/$job.log" >&2
    exit 1
  fi
done
exit 0
