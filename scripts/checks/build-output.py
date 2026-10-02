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
- The brand files (step 4.2.1: favicons, the web manifest, the link preview image) exist in
  apps/web/public, and the prerendered landing, trust page and recovery guide link them.
- Dev only routes (apps/web/app/**/page.dev.tsx and route.dev.ts, page extensions only under next dev,
  apps/web/next.config.ts) are absent: not in app-path-routes-manifest.json, no .next/server/app
  directory, and no deployable file names their path.

Usage: scripts/checks/build-output.py [--next-dir DIR] [--env-file FILE] [--app-dir DIR]
"""
import argparse
import json
import os
import re
import sys
from urllib.parse import parse_qsl, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIN_LENGTH = 12
LOCAL_ONLY_DIRS = ("cache", "dev")
# ADMIN_WALLETS lists public wallet addresses; SCREENING_PROVIDER names a provider.
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


DEV_ROUTE_FILE = re.compile(r"^(page|route)\.dev\.(tsx|ts|jsx|js)$")


def dev_only_routes(app_dir):
    """URL paths of the dev only route files page.dev.tsx and route.dev.ts (route groups dropped)."""
    routes = []
    for directory, _dirs, files in os.walk(app_dir):
        if any(DEV_ROUTE_FILE.match(name) for name in files):
            segments = os.path.relpath(directory, app_dir).split(os.sep)
            kept = [seg for seg in segments if seg != "." and not (seg.startswith("(") and seg.endswith(")"))]
            routes.append("/" + "/".join(kept))
    return sorted(routes)


def dev_route_problems(next_dir, routes):
    problems = []
    manifest = os.path.join(next_dir, "app-path-routes-manifest.json")
    listed = []
    if os.path.isfile(manifest):
        with open(manifest, encoding="utf-8") as handle:
            listed = list(json.load(handle).values())
    for route in routes:
        for path in listed:
            if path == route or path.startswith(route + "/"):
                problems.append("dev only route " + path + " is in app-path-routes-manifest.json")
        if os.path.exists(os.path.join(next_dir, "server", "app", route.lstrip("/"))):
            problems.append("dev only route " + route + " is in .next/server/app")
    return problems


BRAND_PAGES = ("index.html", "trust.html", os.path.join("app", "recovery.html"))
BRAND_TAGS = (
    ('rel="icon"', "/favicon.svg"),
    ('rel="icon"', "/favicon.ico"),
    ('rel="apple-touch-icon"', "/apple-touch-icon-180.png"),
    ('rel="manifest"', "/site.webmanifest"),
    ('property="og:image"', "/sotto-og-1200x630.png"),
    ('name="twitter:image"', "/sotto-og-1200x630.png"),
)


def brand_problems(next_dir, public_dir, metadata_file):
    """Step 4.2.1: the brand kit's icons, manifest and link preview image exist, and every
    prerendered public page links them. The file list is BRAND_FILES in apps/web/lib/site-metadata.ts."""
    problems = []
    with open(metadata_file, encoding="utf-8") as handle:
        block = re.search(r"BRAND_FILES = \[(.*?)\]", handle.read(), re.S)
    files = re.findall(r'"([^"]+)"', block.group(1)) if block else []
    if not files:
        return ["no BRAND_FILES list in " + os.path.relpath(metadata_file, ROOT)]
    for name in files:
        path = os.path.join(public_dir, name)
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            problems.append("brand file missing or empty: " + os.path.relpath(path, ROOT))
    for page in BRAND_PAGES:
        path = os.path.join(next_dir, "server", "app", page)
        if not os.path.isfile(path):
            problems.append("prerendered page missing: " + os.path.relpath(path, ROOT))
            continue
        with open(path, encoding="utf-8", errors="replace") as handle:
            tags = re.findall(r"<(?:link|meta)\b[^>]*>", handle.read())
        for marker, target in BRAND_TAGS:
            if not any(marker in tag and target in tag for tag in tags):
                problems.append(page + " has no " + marker + " for " + target)
    return problems


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--next-dir", default=os.path.join(ROOT, "apps", "web", ".next"))
    parser.add_argument("--env-file", default=os.path.join(ROOT, "apps", "web", ".env.local"))
    parser.add_argument("--app-dir", default=os.path.join(ROOT, "apps", "web", "app"))
    parser.add_argument("--public-dir", default=os.path.join(ROOT, "apps", "web", "public"))
    parser.add_argument(
        "--metadata-file", default=os.path.join(ROOT, "apps", "web", "lib", "site-metadata.ts")
    )
    args = parser.parse_args()

    if not os.path.isdir(args.next_dir):
        print("error: " + args.next_dir + " does not exist; run pnpm build first", file=sys.stderr)
        return 1
    checks = needles(parse_env_file(args.env_file)) if os.path.isfile(args.env_file) else []
    encoded = [(name, value.encode("utf-8")) for name, value in checks]

    dev_routes = dev_only_routes(args.app_dir)
    route_markers = [(route, route.encode("utf-8")) for route in dev_routes]
    problems = dev_route_problems(args.next_dir, dev_routes)
    problems += brand_problems(args.next_dir, args.public_dir, args.metadata_file)
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
            if not encoded and not route_markers:
                continue
            with open(path, "rb") as handle:
                content = handle.read()
            for name, value in encoded:
                if value in content:
                    problems.append(name + " appears in " + shown)
            for route, marker in route_markers:
                if marker in content:
                    problems.append("dev only route " + route + " is named in " + shown)

    problems = list(dict.fromkeys(problems))
    for problem in problems:
        print("error: " + problem, file=sys.stderr)
    if problems:
        return 1
    source = "apps/web/.env.local" if checks else "no env file"
    print(
        "ok: no env file in .next; none of %d server only values from %s in the %d deployable files;"
        " dev only routes absent (%s); the brand files and every public page's icons and link"
        " preview present" % (len(checks), source, count, ", ".join(dev_routes) or "none")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
