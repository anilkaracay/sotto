# Contributing

Thank you for looking at Sotto. This file says how to set the project up, how to test a change and what a pull request should look like. The full rules are in [`docs/ENGINEERING-RULES.md`](docs/ENGINEERING-RULES.md); the documents start at [`docs/00-INDEX.md`](docs/00-INDEX.md).

Security problems do not go in an issue or a pull request. See [`SECURITY.md`](SECURITY.md).

## Setup

You need the pinned tools of [`docs/VERSIONS.md`](docs/VERSIONS.md): Node.js 24.21.0, pnpm 12.6.0, Rust 1.98.1, the Agave CLI suite 4.2.2 (with `cargo-build-sbf` 4.1.0) and Docker.

```sh
pnpm install --frozen-lockfile
```

Configuration comes from git ignored `.env.local` files, never from the shell. The names are in [`.env.example`](.env.example). Never commit a value. The README's "Run it locally" section has the rest.

## Tests

Run these before every commit:

```sh
pnpm lint
pnpm typecheck
scripts/db-local.sh test-up && pnpm test
```

For a change to the program:

```sh
pnpm program:build
pnpm program:test
```

`pnpm ci:local` runs every job the way the project's CI does, with a local validator: lint, typecheck, unit tests, the build, the browser tests, the program's build and tests, the localnet tests and the repository checks. Run one test suite at a time on a machine.

A feature is done when its acceptance criteria in [`docs/01-PRODUCT.md`](docs/01-PRODUCT.md) pass as automated tests. A test names the criterion it covers in its title, for example `AC-13.2`.

## Branches and commits

- Branch from `main`. One topic per branch.
- One logical change per commit, with a [Conventional Commits](https://www.conventionalcommits.org) message: `feat(web): ...`, `fix(sdk): ...`, `docs: ...`, `test: ...`, `chore: ...`.
- Pin exact versions in `package.json` and `Cargo.toml`, and record a new version in `docs/VERSIONS.md`.
- If behavior changes, update the document that describes it in the same pull request. Documents and code must not disagree.
- Do not force push to `main`.

## Writing

- **No dashes in prose.** Never use the em dash or the en dash, in UI copy, documents, code comments or commit messages. Use a colon, a comma, a middle dot or a new sentence. Hyphens inside names such as `token-2022` are fine. `python3 scripts/checks/no-dashes.py` checks the tracked files and the last commit message.
- Every claim in the UI and in the documents must be true and checked. If a number is shown, it comes from real data or from a measurement.
- Do not state an API name, a program ID or a wallet behavior that you have not verified against its source.

## What will not be merged

- Anything that lets a secret key or a customer's plaintext amount reach a server, a log or the database.
- Anything that gives the program authority over a token account or makes it move tokens.

## License

By contributing you agree that your contribution is licensed under the Apache License, Version 2.0, as section 5 of the [`LICENSE`](LICENSE) says.
