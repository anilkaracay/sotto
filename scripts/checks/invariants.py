#!/usr/bin/env python3
"""Checks the invariant manifest (step 3.9, docs/10-SECURITY.md section 1, docs/11-TESTING.md).

Every invariant I-x of 10 section 1 must be in tests/invariants.json with at least one test or check.
A test is a file and a title: for TypeScript and JavaScript the title of a test, it or describe call
in that file (scripts/checks/test-titles.ts, as the AC manifest reads them); for Rust the name of a
test function in that file. A check is a script that scripts/ci-local.sh runs. Fails when any is
missing, and lists each invariant with what covers it.
"""
import importlib.util
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
INVARIANT = re.compile(r"^\| (I-\d+) \|", re.MULTILINE)
RUST_TEST = re.compile(r"#\[(?:tokio::)?test\]\s*(?:async\s+)?fn\s+(\w+)")

_spec = importlib.util.spec_from_file_location("ac_manifest", ROOT / "scripts/checks/ac-manifest.py")
_ac = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_ac)


def security_invariants(text: str) -> list:
    """The invariant IDs of 10 section 1, in order."""
    section = text.split("## 1.", 1)[1].split("\n## 2.", 1)[0]
    return INVARIANT.findall(section)


def rust_tests(path: pathlib.Path) -> set:
    return set(RUST_TEST.findall(path.read_text()))


def check(manifest: dict, defined: list, titles: dict, rust: dict, ci_script: str, exists) -> tuple:
    """Returns (ok, lines)."""
    problems = []
    lines = []
    listed = manifest["invariants"]
    for invariant in defined:
        entry = listed.get(invariant)
        if entry is None:
            problems.append(f"{invariant} is not in tests/invariants.json")
            continue
        tests = entry.get("tests", [])
        checks = entry.get("checks", [])
        if not tests and not checks:
            problems.append(f"{invariant} has neither a test nor a check")
        for test in tests:
            file, title = test["file"], test["title"]
            if not exists(file):
                problems.append(f"{invariant}: {file} does not exist")
            elif file.endswith(".rs"):
                if title not in rust.get(file, set()):
                    problems.append(f"{invariant}: no Rust test {title} in {file}")
            elif title not in titles.get(file, []):
                problems.append(f"{invariant}: no test titled {title!r} in {file}")
        for script in checks:
            if not exists(script) or script not in ci_script:
                problems.append(f"{invariant}: {script} is not run by scripts/ci-local.sh")
        lines.append(f"{invariant} covered: {len(tests)} tests, {len(checks)} checks")
    extra = sorted(set(listed) - set(defined))
    if extra:
        problems.append(f"tests/invariants.json lists invariants 10 does not define: {extra}")
    if problems:
        return False, [f"FAILED: {problem}" for problem in problems]
    return True, lines + [f"ok: {len(defined)} invariants, each with its tests or checks"]


def main() -> int:
    manifest = json.loads((ROOT / "tests/invariants.json").read_text())
    defined = security_invariants((ROOT / "docs/10-SECURITY.md").read_text())
    files = sorted({t["file"] for e in manifest["invariants"].values() for t in e.get("tests", [])})
    script_files = [f for f in files if not f.endswith(".rs") and (ROOT / f).exists()]
    titles = _ac.titles_by_file(script_files)
    rust = {f: rust_tests(ROOT / f) for f in files if f.endswith(".rs") and (ROOT / f).exists()}
    ci_script = (ROOT / "scripts/ci-local.sh").read_text()
    ok, lines = check(manifest, defined, titles, rust, ci_script, lambda p: (ROOT / p).exists())
    print("\n".join(lines))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
