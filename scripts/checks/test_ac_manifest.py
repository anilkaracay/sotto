"""Tests of scripts/checks/ac-manifest.py: only AC IDs in test titles count (founder, 2026-09-27).

Run: python3 -m unittest discover -s scripts/checks -p 'test_*.py'
"""
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("ac_manifest", HERE / "ac-manifest.py")
ac_manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ac_manifest)

PRODUCT = "- AC-01.1 one\n- AC-01.2 two\n- AC-02.1 three\n"


def manifest(phase, required):
    return {"currentPhase": phase, "phases": {"0": {"required": []}, "1": {"required": required}}}


class TitlesOnly(unittest.TestCase):
    def test_counts_titles_and_ignores_comments_and_other_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "apps").mkdir()
            (root / "apps/a.test.ts").write_text(
                '// it("AC-01.2 in a comment")\n'
                'const x = "AC-02.1 in a string";\n'
                'describe("sign in", () => { it("AC-01.1 works", () => {}); });\n'
            )
            (root / "apps/helper.ts").write_text('it("AC-02.1 not a test file", () => {});\n')
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "add", "."], cwd=root, check=True)
            files = ac_manifest.test_files(root)
            self.assertEqual(files, ["apps/a.test.ts"])
            covered = ac_manifest.covered_acs(ac_manifest.titles_by_file(files, root))
            self.assertEqual(covered, {"AC-01.1"})

    def test_names_several_acs_in_one_title(self):
        covered = ac_manifest.covered_acs({"x.spec.ts": ["AC-01.1 create it (AC-01.2)"]})
        self.assertEqual(covered, {"AC-01.1", "AC-01.2"})


class Phases(unittest.TestCase):
    def test_passes_when_every_required_ac_is_in_a_title(self):
        ok, message = ac_manifest.check(manifest(1, ["AC-01.1"]), PRODUCT, {"AC-01.1"})
        self.assertTrue(ok, message)

    def test_fails_for_a_required_ac_without_a_title(self):
        ok, message = ac_manifest.check(manifest(1, ["AC-01.1", "AC-01.2"]), PRODUCT, {"AC-01.1"})
        self.assertFalse(ok)
        self.assertIn("AC-01.2", message)

    def test_fails_for_an_ac_that_01_does_not_define(self):
        ok, message = ac_manifest.check(manifest(1, ["AC-09.9"]), PRODUCT, {"AC-09.9"})
        self.assertFalse(ok)
        self.assertIn("not defined", message)

    def test_fails_for_an_undefined_current_phase(self):
        ok, _ = ac_manifest.check(manifest(7, []), PRODUCT, set())
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()


class VisualBaselines(unittest.TestCase):
    """Step 3.8: approved screens and their baseline files match."""

    def test_listed_screens_need_their_files_and_files_need_listing(self):
        current = {"currentPhase": 3, "phases": {"3": {"required": [], "visual": True}}}
        listed = {"specs/landing.spec.ts": ["landing-1440"]}
        ok, _ = ac_manifest.check_visual(current, listed, {"specs/landing.spec.ts/landing-1440"})
        self.assertTrue(ok)
        ok, message = ac_manifest.check_visual(current, listed, set())
        self.assertFalse(ok)
        self.assertIn("without a baseline", message)
        ok, message = ac_manifest.check_visual(
            current, listed, {"specs/landing.spec.ts/landing-1440", "specs/x.spec.ts/new"}
        )
        self.assertFalse(ok)
        self.assertIn("not listed as approved", message)

    def test_a_visual_phase_needs_baselines(self):
        current = {"currentPhase": 3, "phases": {"3": {"required": [], "visual": True}}}
        self.assertFalse(ac_manifest.check_visual(current, {}, set())[0])
        earlier = {"currentPhase": 2, "phases": {"2": {"required": [], "visual": False}}}
        self.assertTrue(ac_manifest.check_visual(earlier, {}, set())[0])
