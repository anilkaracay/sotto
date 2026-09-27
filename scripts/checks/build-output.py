#!/usr/bin/env python3
"""The Next.js build output (apps/web/.next) holds no env file and none of the server only values of
apps/web/.env.local (docs/14-ENVIRONMENTS-DEPLOY.md section 2). Only variable names are printed,
never values. Run after pnpm build.

- Env files are searched in all of .next.
- Values are searched in the deployable output only. .next/cache (the Turbopack build cache) and
  .next/dev (next dev output) hold the local values by design and stay on this machine: .next is git
  ignored, outside the Docker build context, not uploaded by the Vercel CLI, and outside the
  Turborepo build outputs.
- Not searched: NEXT_PUBLIC_ values (inlined by design) and PUBLIC_VALUES, which hold public data.

Usage: scripts/checks/build-output.py [--next-dir DIR] [--env-file FILE]
"""
import argparse
import os
import sys
from urllib.parse import parse_qsl, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIN_LENGTH = 12
LOCAL_ONLY_DIRS = ("cache", "dev")
# ADMIN_WALLETS lists public wallet addresses (the dev only wallet lab source holds the same test
# address); SCREENING_PROVIDER names a provider.
PUBLIC_VALUES = {"ADMIN_WALLETS", "SCREENING_PROVIDER"}


def parse_env_file(path):
    values = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            name = name.strip()
            if name.startswith("export "):
                name = name[len("export ") :].strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[name] = value
    return values


def needles(values):
    """Server only values, plus the password and query values of URLs (an API key alone)."""
    found = []
    for name, value in values.items():
        if name.startswith("NEXT_PUBLIC_") or name in PUBLIC_VALUES or len(value) < MIN_LENGTH:
            continue
        found.append((name, value))
        parts = urlsplit(value)
        if parts.scheme and parts.netloc:
            if parts.password and len(parts.password) >= 8:
                found.append((name + " (password)", parts.password))
            for key, part in parse_qsl(parts.query):
                if len(part) >= MIN_LENGTH:
                    found.append((name + " (" + key + ")", part))
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--next-dir", default=os.path.join(ROOT, "apps", "web", ".next"))
    parser.add_argument("--env-file", default=os.path.join(ROOT, "apps", "web", ".env.local"))
    args = parser.parse_args()

    if not os.path.isdir(args.next_dir):
        print("error: " + args.next_dir + " does not exist; run pnpm build first", file=sys.stderr)
        return 1
    checks = needles(parse_env_file(args.env_file)) if os.path.isfile(args.env_file) else []
    encoded = [(name, value.encode("utf-8")) for name, value in checks]

    problems = []
    count = 0
    local_only = tuple(os.path.join(args.next_dir, name) + os.sep for name in LOCAL_ONLY_DIRS)
    for directory, _dirs, files in os.walk(args.next_dir):
        for filename in files:
            path = os.path.join(directory, filename)
            shown = os.path.relpath(path, ROOT)
            if filename.startswith(".env"):
                problems.append("env file in the build output: " + shown)
            if path.startswith(local_only):
                continue
            count += 1
            if not encoded:
                continue
            with open(path, "rb") as handle:
                content = handle.read()
            for name, value in encoded:
                if value in content:
                    problems.append(name + " appears in " + shown)

    for problem in problems:
        print("error: " + problem, file=sys.stderr)
    if problems:
        return 1
    source = "apps/web/.env.local" if checks else "no env file"
    print(
        "ok: no env file in .next; none of %d server only values from %s in the %d deployable files"
        % (len(checks), source, count)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
