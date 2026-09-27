#!/usr/bin/env bash
# Environment files never reach a build artifact or a container image. Hosted environments (Vercel,
# Fly) take configuration only from the platform's environment variables
# (docs/14-ENVIRONMENTS-DEPLOY.md section 2).
# 1. The only tracked env file is .env.example.
# 2. The working tree holds no env file other than .env.example and apps/*/.env.local or
#    packages/*/.env.local. In particular no .env or .env.production: Next.js loads them and, in
#    output "standalone" mode, copies them into .next/standalone (next 16.3.6,
#    dist/build/index.js, writeStandaloneDirectory).
# 3. The Docker build context contains no env file other than .env.example: the context, as
#    filtered by .dockerignore, is exported with docker build --output type=local and searched.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
fail=0

tracked="$(git ls-files | grep -E '(^|/)\.env' | grep -vx '.env.example' || true)"
if [[ -n "$tracked" ]]; then
  echo "error: tracked env files:" >&2
  echo "$tracked" >&2
  fail=1
fi

stray="$(find . \( -name node_modules -o -name .git -o -name target -o -name .cache -o -name .localnet \) -prune \
  -o -name '.env*' -print | sed 's#^\./##' | grep -vxE '\.env\.example|(apps|packages)/[^/]+/\.env\.local' | sort || true)"
if [[ -n "$stray" ]]; then
  echo "error: env files other than .env.example and apps/*/.env.local or packages/*/.env.local:" >&2
  echo "$stray" >&2
  fail=1
fi

if ! docker info >/dev/null 2>&1; then
  echo "error: docker is not available, so the Docker build context cannot be checked" >&2
  exit 1
fi
context="$(mktemp -d)"
trap 'rm -rf "$context"' EXIT
printf 'FROM scratch\nCOPY . /\n' | docker build --quiet -f - --output "type=local,dest=$context" . >/dev/null
in_context="$(cd "$context" && find . -name '.env*' | sed 's#^\./##' | grep -vx '.env.example' | sort || true)"
if [[ -n "$in_context" ]]; then
  echo "error: env files in the Docker build context (.dockerignore):" >&2
  echo "$in_context" >&2
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "ok: only .env.example is tracked; the Docker build context ($(find "$context" -type f | wc -l | tr -d ' ') files) holds no env file other than .env.example"
