#!/usr/bin/env python3
"""Checks the phase scoped AC manifest (X-46, docs/11-TESTING.md section 4).

The current phase is read from tests/ac-manifest.json ("currentPhase"), the single source.
Fails if an AC required at the current phase has no test whose name contains the AC ID, or if the
manifest lists an AC that docs/01-PRODUCT.md does not define.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
AC_PATTERN = re.compile(r"AC-\d{2}\.\d+")
TEST_FILE = re.compile(r"(\.test\.tsx?$|\.spec\.tsx?$|^programs/.*\.rs$|^tests/e2e/)")


def main() -> int:
    manifest = json.loads((ROOT / "tests/ac-manifest.json").read_text())
    phase = str(manifest["currentPhase"])
    if phase not in manifest["phases"]:
        print(f"FAILED: currentPhase {phase} is not defined in tests/ac-manifest.json")
        return 1
    defined = set(AC_PATTERN.findall((ROOT / "docs/01-PRODUCT.md").read_text()))
    listed = {ac for p in manifest["phases"].values() for ac in p["required"]}
    unknown = sorted(listed - defined)
    if unknown:
        print(f"FAILED: manifest lists ACs not defined in docs/01-PRODUCT.md: {unknown}")
        return 1
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, check=True, capture_output=True, text=True)
    covered = set()
    for path in files.stdout.splitlines():
        if TEST_FILE.search(path):
            covered |= set(AC_PATTERN.findall((ROOT / path).read_text(errors="ignore")))
    required = manifest["phases"][phase]["required"]
    missing = [ac for ac in required if ac not in covered]
    if missing:
        print(f"FAILED: phase {phase} requires tests for: {missing}")
        return 1
    print(f"ok: phase {phase}, {len(required)} required ACs, all covered")
    return 0


if __name__ == "__main__":
    sys.exit(main())
