"""Tests of scripts/checks/invariants.py (step 3.9): every invariant of 10 section 1 is covered.

Run: python3 -m unittest discover -s scripts/checks -p 'test_*.py'
"""
import importlib.util
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("invariants", HERE / "invariants.py")
invariants = importlib.util.module_from_spec(spec)
spec.loader.exec_module(invariants)

SECURITY = """## 1. Invariants

| ID | Invariant | Enforced by |
|----|-----------|-------------|
| I-1 | One | a test |
| I-2 | Two | a check |

## 2. Threats
| I-9 | Not an invariant row of section 1 | |
"""

TITLES = {"apps/a.test.ts": ["keeps amounts out"]}
RUST = {"programs/p/tests/t.rs": {"calls_no_token_program"}}
CI = "run scripts/checks/grep.sh"


def manifest(**overrides):
    entries = {
        "I-1": {"tests": [{"file": "apps/a.test.ts", "title": "keeps amounts out"}], "checks": []},
        "I-2": {"tests": [{"file": "programs/p/tests/t.rs", "title": "calls_no_token_program"}],
                "checks": ["scripts/checks/grep.sh"]},
    }
    entries.update(overrides)
    return {"invariants": {k: v for k, v in entries.items() if v is not None}}


def everything_exists(_path):
    return True


class Invariants(unittest.TestCase):
    def test_reads_only_section_1(self):
        self.assertEqual(invariants.security_invariants(SECURITY), ["I-1", "I-2"])

    def test_passes_when_every_invariant_is_covered(self):
        ok, lines = invariants.check(manifest(), ["I-1", "I-2"], TITLES, RUST, CI, everything_exists)
        self.assertTrue(ok, lines)
        self.assertIn("I-1 covered: 1 tests, 0 checks", lines)

    def test_fails_on_a_missing_invariant_or_one_without_coverage(self):
        ok, lines = invariants.check(manifest(**{"I-2": None}), ["I-1", "I-2"], TITLES, RUST, CI, everything_exists)
        self.assertFalse(ok)
        self.assertIn("FAILED: I-2 is not in tests/invariants.json", lines)
        ok, lines = invariants.check(
            manifest(**{"I-1": {"tests": [], "checks": []}}), ["I-1", "I-2"], TITLES, RUST, CI, everything_exists
        )
        self.assertIn("FAILED: I-1 has neither a test nor a check", lines)

    def test_fails_on_a_title_a_rust_test_or_a_check_that_does_not_exist(self):
        wrong = manifest(**{
            "I-1": {"tests": [{"file": "apps/a.test.ts", "title": "renamed"}], "checks": []},
            "I-2": {"tests": [{"file": "programs/p/tests/t.rs", "title": "gone"}], "checks": ["scripts/checks/other.sh"]},
        })
        ok, lines = invariants.check(wrong, ["I-1", "I-2"], TITLES, RUST, CI, everything_exists)
        self.assertFalse(ok)
        joined = "\n".join(lines)
        self.assertIn("no test titled 'renamed'", joined)
        self.assertIn("no Rust test gone", joined)
        self.assertIn("scripts/checks/other.sh is not run by scripts/ci-local.sh", joined)

    def test_reads_rust_test_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "t.rs"
            path.write_text("#[test]\nfn plain() {}\n#[tokio::test]\nasync fn awaited() {}\nfn helper() {}\n")
            self.assertEqual(invariants.rust_tests(path), {"plain", "awaited"})


if __name__ == "__main__":
    unittest.main()
