#!/usr/bin/env python3
"""Fails if a tracked file or a commit message contains an en dash or an em dash (ENGINEERING-RULES.md rule 7).

Usage: scripts/checks/no-dashes.py [commit]   (commit message to check, default HEAD)
"""
import subprocess
import sys

FORBIDDEN = {"–": "en dash", "—": "em dash"}


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout


def main() -> int:
    commit = sys.argv[1] if len(sys.argv) > 1 else "HEAD"
    problems = []
    for raw in git("ls-files", "-z").split(b"\0"):
        if not raw:
            continue
        path = raw.decode()
        try:
            text = open(path, "rb").read().decode("utf-8")
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue  # binary or not a regular file
        for number, line in enumerate(text.splitlines(), 1):
            for char, name in FORBIDDEN.items():
                if char in line:
                    problems.append(f"{path}:{number}: {name}")
    message = git("log", "-1", "--format=%B", commit).decode("utf-8")
    for char, name in FORBIDDEN.items():
        if char in message:
            problems.append(f"commit message of {commit}: {name}")
    for problem in problems:
        print(problem)
    if problems:
        print(f"FAILED: {len(problems)} en or em dash occurrences (ENGINEERING-RULES.md rule 7)")
        return 1
    print("ok: no en or em dash in tracked files or the commit message")
    return 0


if __name__ == "__main__":
    sys.exit(main())
