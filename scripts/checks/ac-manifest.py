#!/usr/bin/env python3
"""Checks the phase scoped AC manifest (X-46, docs/11-TESTING.md section 4).

The current phase is read from tests/ac-manifest.json ("currentPhase"), the single source.
Fails if an AC required at the current phase has no test whose title contains the AC ID, or if the
manifest lists an AC that docs/01-PRODUCT.md does not define.

A test title is the first argument of a test, it or describe call in a TypeScript or JavaScript test
file (scripts/checks/test-titles.ts parses the files with the TypeScript compiler). An AC ID in a
comment, an assertion or any other text does not count (founder, 2026-09-27). Rust tests have no
string titles and do not count for an AC.

Since step 3.8 it also checks the visual baselines: every screen tests/e2e/visual-screens.json lists
has its baseline file, every baseline file is listed (only approved screens have one), and a phase
whose "visual" flag is set, once current, has at least one.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
AC_PATTERN = re.compile(r"AC-\d{2}\.\d+")
TEST_FILE = re.compile(r"(\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$|^tests/e2e/.*\.[cm]?[jt]sx?$)")
TITLES = ROOT / "scripts/checks/test-titles.ts"


def test_files(root: pathlib.Path = ROOT) -> list:
    files = subprocess.run(["git", "ls-files"], cwd=root, check=True, capture_output=True, text=True)
    return [path for path in files.stdout.splitlines() if TEST_FILE.search(path)]


def titles_by_file(paths: list, root: pathlib.Path = ROOT) -> dict:
    if not paths:
        return {}
    result = subprocess.run(
        ["node", str(TITLES), *paths], cwd=root, check=True, capture_output=True, text=True
    )
    return json.loads(result.stdout)


def covered_acs(titles: dict) -> set:
    return {ac for file_titles in titles.values() for title in file_titles for ac in AC_PATTERN.findall(title)}


def check(manifest: dict, product_text: str, covered: set) -> tuple:
    """Returns (ok, message)."""
    phase = str(manifest["currentPhase"])
    if phase not in manifest["phases"]:
        return False, f"FAILED: currentPhase {phase} is not defined in tests/ac-manifest.json"
    defined = set(AC_PATTERN.findall(product_text))
    listed = {ac for p in manifest["phases"].values() for ac in p["required"]}
    unknown = sorted(listed - defined)
    if unknown:
        return False, f"FAILED: manifest lists ACs not defined in docs/01-PRODUCT.md: {unknown}"
    required = manifest["phases"][phase]["required"]
    missing = [ac for ac in required if ac not in covered]
    if missing:
        return False, f"FAILED: phase {phase} requires tests whose titles name: {missing}"
    return True, f"ok: phase {phase}, {len(required)} required ACs, all named in test titles"


VISUAL_LIST = ROOT / "tests/e2e/visual-screens.json"


def baseline_files(root: pathlib.Path = ROOT) -> set:
    """Every baseline as "<folder>/<spec>/<name>", from the files under tests/e2e."""
    found = set()
    for folder in ("specs", "localnet"):
        for path in (root / "tests/e2e" / folder / "__screenshots__").glob("*/*.png"):
            found.add(f"{folder}/{path.parent.name}/{path.stem}")
    return found


def check_visual(manifest: dict, listed: dict, present: set) -> tuple:
    """Returns (ok, message) for the visual baselines."""
    wanted = {f"{spec}/{name}" for spec, names in listed.items() for name in names}
    missing = sorted(wanted - present)
    if missing:
        return False, f"FAILED: approved screens without a baseline: {missing}"
    unlisted = sorted(present - wanted)
    if unlisted:
        return False, f"FAILED: baselines of screens not listed as approved: {unlisted}"
    phase = str(manifest["currentPhase"])
    if manifest["phases"].get(phase, {}).get("visual") and not wanted:
        return False, f"FAILED: phase {phase} requires visual baselines and none is listed"
    return True, f"ok: {len(wanted)} visual baselines, each of an approved screen"


def main() -> int:
    manifest = json.loads((ROOT / "tests/ac-manifest.json").read_text())
    product = (ROOT / "docs/01-PRODUCT.md").read_text()
    covered = covered_acs(titles_by_file(test_files()))
    ok, message = check(manifest, product, covered)
    print(message)
    listed = json.loads(VISUAL_LIST.read_text())["screens"]
    visual_ok, visual_message = check_visual(manifest, listed, baseline_files())
    print(visual_message)
    ok = ok and visual_ok
    if "--list" in sys.argv:
        print("ACs named in test titles: " + (", ".join(sorted(covered)) or "none"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
