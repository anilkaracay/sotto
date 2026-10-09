# Versions

Every pinned tool, crate and package, with the date it was resolved.

| Component | Version | Resolved on | Source | Notes |
|-----------|---------|-------------|--------|-------|
| Host | macOS 26.6.2 (25G83), arm64, Apple M5 | 2026-09-26 | `sw_vers`, `uname -m` | Development machine, not pinned |
| Agave CLI suite (`solana`, `solana-test-validator`, `solana-keygen`, `agave-install`) | 4.2.2 (src `e29e5d91`, feat `21b0d33a`, client Agave, channel stable) | 2026-09-26 | https://release.anza.xyz/stable/solana-release-aarch64-apple-darwin.tar.bz2 · https://github.com/anza-xyz/agave/releases/tag/v4.2.2 | `e29e5d9` is tag `v4.2.2` (`c9c6f32`) plus one CI only backport commit. `agave-install info`: "Install is up to date". v1 transactions locally need Solana CLI v4.2+ (see the verification log, G0) |
| `cargo-build-sbf` and `cargo-test-sbf` | 4.1.0 | 2026-09-26 | https://github.com/anza-xyz/agave/blob/v4.2.2/scripts/cargo-build-sbf-version.sh | Shipped in the Agave 4.2.2 release and pinned there (`cargoBuildSbfVersion=4.1.0`). Kept as pinned; do not upgrade (founder decision) |
| Platform tools (onchain program compiler) | v1.54, rustc 1.89.0-dev | 2026-09-26 | `cargo-build-sbf --version`; `~/.cache/solana/v1.54/platform-tools/rust/bin/rustc --version` | Onchain programs build with this rustc, bundled with `cargo-build-sbf` 4.1.0. Separate from the host Rust toolchain |
| `spl-token-cli` | 5.6.1 | 2026-09-26 | https://crates.io/crates/spl-token-cli | Shipped in the Agave 4.2.2 release tarball; latest on crates.io. Has every confidential command used in G1 step 6 |
| `spl-token-wrap-cli` (binary `spl-token-wrap`) | 2.0.0 | 2026-09-26 | https://crates.io/crates/spl-token-wrap-cli | Installed with `cargo install --locked spl-token-wrap-cli --version 2.0.0`. Owner `anza-team`, repository `solana-program/token-wrap` |
| Rust host toolchain (`rustc`, `cargo`) | 1.98.1 (`48a229cea` 2026-09-01), cargo 1.98.1 | 2026-09-26 | `rustup check` (stable channel, https://static.rust-lang.org) | To be pinned in `rust-toolchain.toml` at step 0.4 |
| rustup | 1.29.1 | 2026-09-26 | `rustup --version` | Self updated from 1.29.0 by `rustup update stable` |
| Node.js | 24.21.0 (LTS "Krypton") | 2026-09-26 | https://nodejs.org/dist/index.json | Latest 24.x (released 2026-09-07). fnm default |
| npm | 11.19.0 | 2026-09-26 | Bundled with Node.js 24.21.0 | |
| corepack | 0.36.0 | 2026-09-26 | Bundled with Node.js 24.21.0 | |
| pnpm | 12.6.0 | 2026-09-26 | https://registry.npmjs.org/pnpm (dist-tag `latest`) | Activated with corepack (`corepack install -g pnpm@12.6.0`). Pinned in `packageManager` at step 0.4; Turborepo support for pnpm 12 checked at step 0.4 |
| fnm | 1.39.0 | 2026-09-26 | `fnm --version` | Node version manager |
| Anchor CLI and avm | not installed | 2026-09-26 | https://github.com/otter-sec/anchor/blob/master/avm/anchor-solana-map.toml | Deferred to step 0.4 by D-16 (GATE). Latest stable 1.2.0; no source states compatibility with Agave 4.2.x |
| git | 2.50.1 (Apple Git-155) | 2026-09-26 | `git --version` | Host tool, not pinned |
| Docker | client 29.8.1, server 29.7.2 | 2026-09-26 | `docker --version`, `docker info` | Local Postgres runs in Docker; host tool, not pinned |
| Homebrew | 7.0.6 | 2026-09-26 | `brew --version` | Host tool, not pinned |
| `spl-token-wrap` (Token Wrap program crate, upstream) | 1.0.0 | 2026-09-26 | https://crates.io/crates/spl-token-wrap (crate SHA-256 `fedeedf8417f86136fa93df58a62793f11a9c7d692bf413106db06437b0a8d60`) | Latest program crate; there is no 2.0.0. Used by `spl-token-wrap-cli` 2.0.0. Declares `TwRap…`, which is not deployed on mainnet or devnet (facts C5) |
| Token Wrap devnet test build (patched `spl-token-wrap` 1.0.0) | 1.0.0 + one line patch | 2026-09-26 | Source outside the repo: `/tmp/sotto-g1/token-wrap-patched/spl-token-wrap-1.0.0` | `.so` 447296 bytes, SHA-256 `533a3023040ee2a70f7687dcb1086462c5acd5960ad805327b708a02013eb22a`. Devnet program ID `EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn`, upgrade authority wallet A, last deployed slot 504434718. Not canonical (D-01). Patch and build below |
| Token Wrap unpatched build (superseded) | 1.0.0 | 2026-09-26 | crates.io source, `cargo-build-sbf -- --locked` | `.so` SHA-256 `bd554d6f3cccf3e90b6b7f4d774741523700222fea0e972bb21d0551d406e041`. First deployed at `EEvq…` (slot 504428800), cannot work there (facts C6), replaced by the patched build |
| `spl-token-wrap-cli` patched copy (binary `spl-token-wrap`) | 2.0.0 | 2026-09-26 | https://crates.io/crates/spl-token-wrap-cli (crate SHA-256 `001a5dc00c23fad0054e58b8cfd3c05be487100779d8a596d5427321c15b13c2`) | Built outside the repo against the patched crate; invoke by full path `/tmp/sotto-g1/cli-patched/target/release/spl-token-wrap`, never installed. The globally installed 2.0.0 targets `TwRap…` only |
| Localnet Token-2022 | devnet program, cloned at validator start | 2026-09-26 | `--clone-upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb --url https://api.devnet.solana.com` | On 2026-09-26 the clone had SHA-256 `b781b71d230a9910de4d3c103e72608f597fc73c83ee207242ac82b708382a6a` (711008 bytes, devnet last deployed slot 503153936). The bundled `spl_token_2022-10.0.0.so` (SHA-256 `a794161408080f690dac00832f45b3c3e2b71f1339586667ad1f979cf91d5b68`) has no confidential transfer support (facts H3). The clone follows devnet upgrades |
| Cluster nodes (observed) | Agave 4.3.0 | 2026-09-26 | Public RPC `apiVersion` on mainnet and devnet | Observation, not pinned (facts H2) |
| `sas-lib` (read only) | 1.0.10 | 2026-09-26 | https://registry.npmjs.org/sas-lib (dist-tag `latest`) | Tarball read for the SAS program ID; not installed. Pin at scaffold |
| Verification only (not project dependencies) | `@solana/kit` 8.3.0, `@solana-program/token-wrap` 2.7.1, `@solana-program/system` 0.15.0 | 2026-09-26 | npm | Installed in `/tmp/sotto-g1/sim` for the G1 CreateMint simulation. Project versions are pinned at step 0.4 |

## Token Wrap devnet test build (G1, 2026-09-26)

Upstream: `spl-token-wrap` 1.0.0 from crates.io. The only source change, `src/lib.rs` line 19:

```diff
-solana_pubkey::declare_id!("TwRapQCDhWkZRrDaHfZGuHxkZ91gHDRkyuzNqeU5MgR");
+solana_pubkey::declare_id!("EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn");
```

Build (in the patched source directory, `cargo-build-sbf` 4.1.0, platform-tools v1.54, rustc 1.89.0):

```sh
cargo-build-sbf -- --locked
```

Result: `target/deploy/spl_token_wrap.so`, 447296 bytes, SHA-256 `533a3023040ee2a70f7687dcb1086462c5acd5960ad805327b708a02013eb22a`. Program keypair (outside the repo): `~/.config/solana/sotto/token-wrap-devnet.json`, public key `EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn`.

## Patched `spl-token-wrap-cli` 2.0.0 (G1, 2026-09-26)

Only change: in `Cargo.toml`, `[dependencies.spl-token-wrap]` gains `path = "/tmp/sotto-g1/token-wrap-patched/spl-token-wrap-1.0.0"` (version `1.0.0` and features unchanged). Build, in `/tmp/sotto-g1/cli-patched/spl-token-wrap-cli-2.0.0`, cargo 1.98.1:

```sh
CARGO_TARGET_DIR=/tmp/sotto-g1/cli-patched/target cargo build --release --bin spl-token-wrap
```

Resulting `Cargo.lock` change: the `spl-token-wrap` entry loses its registry `source` and `checksum`; nothing else changes.

## Localnet validator command (G1, 2026-09-26)

For `scripts/localnet.sh` at step 0.4. The ledger path and the `.so` path are the G1 locations; the script replaces them with its own paths.

```sh
solana-test-validator --reset --quiet \
  --ledger /tmp/sotto-g1/ledger \
  --url https://api.devnet.solana.com \
  --clone-upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --upgradeable-program EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn \
    /tmp/sotto-g1/token-wrap-patched/spl-token-wrap-1.0.0/target/deploy/spl_token_wrap.so \
    7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L
```

- `solana-test-validator` 4.2.2 activates all features at genesis, including the three ZK ElGamal gates and `enable_tx_v1`, so the proof program is enabled (facts B6).
- `--clone-upgradeable-program` Token-2022 from devnet is required: the bundled Token-2022 10.0.0 rejects confidential instructions (facts H3). The clone needs network access to the public devnet RPC at start.
- Token Wrap is loaded at the same ID as devnet, with wallet A as upgrade authority.
| Anchor CLI and avm (update) | not used | 2026-09-26 | `03-DECISIONS.md` D-16 | D-16 gate at step 0.4 selected a native program; Anchor is not installed |
| Turborepo (`turbo`) | 2.11.4 | 2026-09-26 | https://registry.npmjs.org/turbo (dist-tag `latest`); GitHub release v2.11.4 (2026-09-24) | pnpm 12 support: https://turborepo.com/docs/getting-started/support-policy lists "pnpm 8+ Stable"; Turborepo's own repository moved to pnpm 12 in PR #13879 (2026-08-29) |
| TypeScript | 6.0.3 | 2026-09-26 | https://registry.npmjs.org/typescript | `latest` is 7.0.2, but `typescript-eslint` 8.70.1 requires `typescript >=4.8.4 <6.1.0`; 6.0.3 is the newest version inside that range. Satisfies `@solana/kit` 8.3.0 (`>=5.4.0`) |
| ESLint, `@eslint/js` | 10.11.0, 10.0.1 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | Flat config in `@sotto/config` |
| `typescript-eslint` | 8.70.1 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | `configs.strict` |
| `@next/eslint-plugin-next`, `eslint-plugin-react-hooks`, `globals` | 16.3.6, 7.1.1, 17.12.0 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | Web lint rules |
| Prettier | 3.9.9 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | `printWidth` 100; `docs/`, `design/`, `programs/`, `vendor/` ignored |
| Vitest, Vite | 5.0.2, 8.3.1 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | Vite is a required peer of Vitest 5 (`^6.4.0 || ^7.0.0 || ^8.0.0`) |
| `@types/node` | 24.19.0 | 2026-09-26 | https://registry.npmjs.org/@types/node | Latest 24.x, matching Node 24.21.0 (`latest` is 26.6.3). pnpm 12 added it to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` at first install because it was published within pnpm's default minimum release age |
| Next.js | 16.3.6 | 2026-09-26 | https://registry.npmjs.org/next (dist-tag `latest`) | App Router; `next typegen` before `tsc` |
| React, React DOM, `@types/react`, `@types/react-dom` | 19.3.0 each | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | |
| `@solana/kit` | 8.3.0 | 2026-09-26 | https://registry.npmjs.org/@solana/kit (dist-tag `latest`) | `sas-lib` 1.0.10 brings its own `@solana/kit` 5.5.1 |
| `@solana-program/token-2022` | 0.19.0 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | Exports `.` and `./confidential`. `@solana-program/token-wrap` 2.7.1 also pulls `@solana-program/token-2022` 0.17.0 |
| `@solana/zk-sdk` | 0.5.3 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | Exports `.`, `./node`, `./web`, `./bundler` |
| `@solana-program/zk-elgamal-proof` | 0.4.0 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | |
| `@solana-program/token-wrap` | 2.7.1 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | Program ID from the cluster config, never `TOKEN_WRAP_PROGRAM_ADDRESS` (D-01) |
| `@solana/sysvars` | 8.3.0 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | Peer of `@solana-program/token-2022` 0.19.0 |
| `sas-lib` (installed) | 1.0.10 | 2026-09-26 | https://registry.npmjs.org/sas-lib (dist-tag `latest`) | Depends on `@solana/kit ^5.0.0`; 2.0.0-beta.1 peers `@solana/kit ^7.0.0` |
| Wallet Standard React (verified, not installed) | `@solana/react` 8.3.0, `@wallet-standard/react` 1.0.3 | 2026-09-26 | https://registry.npmjs.org (dist-tag `latest`) | Both exist. `@solana/react` peers: `@solana/kit ^8.3.0`, `react >=18`, `swr ^2.5.1`, `@tanstack/react-query ^5.0.0`. `@wallet-standard/react` engines `node >=22`. Installed with the wallet work (step 0.6 or Phase 1) |
| `sotto_proofs` crates | `solana-account-info` 3.1.1, `solana-address` 2.8.0, `solana-program-entrypoint` 3.1.1, `solana-program-error` 3.0.1 | 2026-09-26 | https://crates.io (max stable; equal to the versions `spl-token-2022` 11.1.0 resolves) | Exact pins (`=`) in `programs/sotto_proofs/Cargo.toml`; `Cargo.lock` committed. Native program (D-16) |
| Gate G4 probe crates (`programs/g4_probe`, step 2.2; the set `sotto_proofs` takes in step 2.7) | `spl-token-2022-interface` 3.1.2, `solana-zk-elgamal-proof-interface` 0.1.3, `solana-zk-sdk-pod` 0.1.2, `spl-token-confidential-transfer-ciphertext-arithmetic` 0.5.1, `bytemuck` 1.25.0, with the core crates of the row above | 2026-09-29 | the `spl-token-2022` 11.1.0 dependency tree (`cargo tree`; facts K1) | Exact pins (`=`); `Cargo.lock` committed. Built with `cargo-build-sbf --manifest-path programs/g4_probe/Cargo.toml --arch v3 -- --locked` (the local validator refuses SBPF v0 to v2 deployments, facts K8); never deployed beyond a local validator |

## Project commands (step 0.4, 2026-09-26)

```sh
pnpm install --frozen-lockfile
pnpm lint          # turbo run lint (ESLint per package) and prettier --check .
pnpm typecheck     # turbo run typecheck (tsc --noEmit; web runs next typegen first)
pnpm test          # turbo run test (Vitest per package)
pnpm build         # turbo run build (Next.js production build)
pnpm program:build # cargo-build-sbf --manifest-path programs/sotto_proofs/Cargo.toml --arch v3 -- --locked (--arch v3 since step 2.7)
pnpm program:test  # cargo test --locked -p sotto_proofs
scripts/localnet.sh        # foreground validator (fetches the Token Wrap .so first)
scripts/localnet-smoke.sh  # against a running localnet
```

`scripts/localnet.sh` implements the localnet validator command recorded above, with the ledger at `.localnet/ledger` and the Token Wrap program at `.cache/token-wrap/spl_token_wrap.so` (both ignored).
| `actions/checkout` | v7.0.1, `3d3c42e5aac5ba805825da76410c181273ba90b1` | 2026-09-26 | https://github.com/actions/checkout/releases/tag/v7.0.1 (release `latest`; the tag points directly at this commit) | Pinned by full SHA in `.github/workflows/ci.yml` |
| `actions/setup-node` | v7.0.0, `820762786026740c76f36085b0efc47a31fe5020` | 2026-09-26 | https://github.com/actions/setup-node/releases/tag/v7.0.0 | `node-version-file: .node-version`, `package-manager-cache: false` |
| `actions/cache` | v6.1.0, `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | 2026-09-26 | https://github.com/actions/cache/releases/tag/v6.1.0 | pnpm store, cargo registry and target, Agave install and platform tools |
| `actions/upload-artifact` | v7.0.1, `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | 2026-09-26 | https://github.com/actions/upload-artifact/releases/tag/v7.0.1 | Validator logs on localnet job failure; the `sotto_proofs` build, from the program job to the localnet job |
| `actions/download-artifact` | v8.0.1, `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` | 2026-10-09 | https://github.com/actions/download-artifact/releases/tag/v8.0.1 (the tag points directly at this commit) | The `sotto_proofs` build in the localnet job |
| gitleaks (binary, no action) | 8.30.1 | 2026-09-26 | https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1 (release `latest`, 2026-03-21) and its `gitleaks_8.30.1_checksums.txt` | Release tarball SHA-256 pinned and checked against the checksums file: `linux_x64` `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` (workflow), `darwin_arm64` `b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5` and `darwin_x64` `dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709` (`scripts/ci-local.sh`). Full history scan with `.gitleaks.toml` (founder choice over `gitleaks-action`, which scans only the pushed range on push and pull_request) |
| Agave installer for CI | `https://release.anza.xyz/v4.2.2/install` | 2026-09-26 | https://docs.anza.xyz/cli/install ("You can replace v4.3.0 with the release tag matching the software version of your desired release") | Used by `.github/actions/setup-agave`. The tag v4.2.2 build (`c9c6f32`) differs from this machine's install (`e29e5d9`, v4.2.2 plus one CI only backport commit) |
| GitHub runner image | `ubuntu-24.04` | 2026-09-26 | GitHub hosted runner label | Workflow only; runs after the public launch (D-25) |
| Wallet packages installed in `apps/web` (step 0.6) | `@solana/react` 8.3.0, `@wallet-standard/react` 1.0.3, `@solana/wallet-standard-features` 1.5.0, `@solana-program/system` 0.15.0 | 2026-09-27 | https://registry.npmjs.org (dist-tag `latest`; resolved versions read from the installed packages) | Catalog pins in `pnpm-workspace.yaml`. `@solana/wallet-standard-features` 1.5.0 is the minimum for v1 transactions (G0 task 1 source). Used by the dev only wallet lab; `@solana/react` peers `swr` and `@tanstack/react-query` are optional and not installed |
| Local Postgres (Docker) | `postgres:16.15`, `sha256:1a6ab3f5345eb6dbe04a1349529caabdb0ab09293a09590fad07b2246bfa4b54` | 2026-09-27 | https://hub.docker.com/_/postgres (latest 16.x tag; D-12 PostgreSQL 16) | Container `sotto-postgres`, volume `sotto-pgdata`, port `127.0.0.1:56432`. Command below |

## Local Postgres container (Phase 1 kickoff, 2026-09-27)

```sh
docker volume create sotto-pgdata
docker run -d --name sotto-postgres --restart unless-stopped \
  -e POSTGRES_USER=sotto -e POSTGRES_DB=sotto \
  -e POSTGRES_PASSWORD=<the password in DATABASE_URL of the .env.local files> \
  -p 127.0.0.1:56432:5432 -v sotto-pgdata:/var/lib/postgresql/data postgres:16.15
```

`DATABASE_URL=postgresql://sotto:<password>@127.0.0.1:56432/sotto` in `apps/web/.env.local` and `apps/worker/.env.local`. Step 1.2 wraps this in `scripts/db-local.sh`.

## Step 1.1 (2026-09-27): SAS, worker configuration, transaction helpers

No new third party package versions. Changes:

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| `@solana/kit` in `apps/worker` | 8.3.0 (catalog) | 2026-09-27 | `pnpm-workspace.yaml` catalog, lockfile `apps/worker` importer | Added as a direct worker dependency for RPC, signing and the SAS client; `sas-lib` 1.0.10 keeps its nested `@solana/kit` 5.5.1 (`node_modules/.pnpm/@solana+kit@5.5.1_typescript@6.0.3`), used only inside `sas-lib` (D-24, facts E6) |
| SAS program on localnet | devnet program, cloned at validator start | 2026-09-27 | `--clone-upgradeable-program 22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG --url https://api.devnet.solana.com` | Dump SHA-256 `afacc7215d6ab6759bcf5edb958a1ad1d9de7559d53ac807c6aa4775a1a5a357` (135680 bytes), equal on localnet and devnet (facts E8). The clone follows devnet upgrades |
| Node built ins used by the worker | Node 24.21.0 | 2026-09-27 | `node:util` `parseEnv` and `parseArgs` | `parseEnv` is the parser behind `node --env-file`; it returns keys in sorted order, not file order |

Localnet validator command as run by `scripts/localnet.sh` from step 1.1 (the G1 command above plus the SAS clone):

```sh
solana-test-validator --reset --quiet \
  --ledger .localnet/ledger \
  --url https://api.devnet.solana.com \
  --clone-upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --clone-upgradeable-program 22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG \
  --upgradeable-program EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn \
    .cache/token-wrap/spl_token_wrap.so \
    7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L
```

New commands:

```sh
pnpm --filter @sotto/worker bootstrap:sas --cluster devnet [--test-attestation <owner>]    # reads apps/worker/.env.local
pnpm --filter @sotto/worker bootstrap:sas --cluster localnet [--test-attestation <owner>]  # http://127.0.0.1:8899
SOTTO_LOCALNET_RPC_URL=http://127.0.0.1:8899 pnpm --filter @sotto/worker test:localnet   # run by the ci:local localnet job (since step 1.4 also needs the test Postgres, see below)
```

## Step 1.1.1 (2026-09-27): hosted configuration checks

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| Docker (this machine) | client 29.8.1, server 29.7.2, buildx v0.36.1-desktop.1 | 2026-09-27 | `docker version`, `docker buildx version` | Runs the local Postgres container and `scripts/checks/env-files.sh`, which exports the build context with BuildKit (`docker build --output type=local`) |

## Step 1.2 (2026-09-27): database and API foundation

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| `drizzle-orm` | 0.45.3 | 2026-09-27 | https://registry.npmjs.org/drizzle-orm (dist-tag `latest`, published 2026-09-21) | 1.0.0 is a release candidate (dist-tag `rc`), not stable. `pg-core` has no `bytea` column in this version; `packages/db/src/columns.ts` defines one with `customType` |
| `drizzle-kit` | 0.31.11 | 2026-09-27 | https://registry.npmjs.org/drizzle-kit (dist-tag `latest`, published 2026-09-21) | devDependency of `packages/db` (migration generation, drift test through `drizzle-kit/api`). It brings the deprecated `@esbuild-kit/core-utils` 3.3.2 and `@esbuild-kit/esm-loader` 2.6.5, `esbuild` 0.18.20 and 0.25.12, and `tsx` 4.23.15 with `esbuild` 0.28.2 (which Vite now also links as its optional `tsx` peer) |
| `postgres` (postgres.js) | 3.4.9 | 2026-09-27 | https://registry.npmjs.org/postgres (dist-tag `latest`, published 2026-04-05) | Driver for `drizzle-orm/postgres-js`, with `prepare: false` for transaction pooling (Neon pooler, D-12). Next 16.3.6's default server external list names `pg`, not `postgres`; Turbopack bundles it without configuration |
| `zod` | 4.6.5 | 2026-09-27 | https://registry.npmjs.org/zod (dist-tag `latest`, published 2026-09-13) | Request validation in `apps/web`; issue messages do not echo input values |
| `dotenv` | 18.0.4 | 2026-09-27 | https://registry.npmjs.org/dotenv (dist-tag `latest`, published 2026-09-25) | `packages/db` scripts: `config({ path, override: true, quiet: true })`. Version 18 also reads `DOTENV_*` variables as defaults; options passed directly take precedence |
| pnpm `allowBuilds` | `esbuild: false` | 2026-09-27 | https://pnpm.io/settings/build (`strictDepBuilds` default true since pnpm 10.3.0) | Reviewed denial of esbuild's postinstall, which only checks and links the platform binary; pnpm installs the binary as the optional `@esbuild/<platform>` package and `drizzle-kit generate` works without the script. A failed install had written a placeholder `allowBuilds` entry into `pnpm-workspace.yaml`, removed |
| Test Postgres | `postgres:16.15` at the digest above | 2026-09-27 | the image of the local Postgres row | Throwaway container for tests, command below |

Test Postgres (`scripts/db-local.sh test-up`; the workflow uses a `postgres` service container with the same image and port):

```sh
docker run -d --rm --name sotto-postgres-test -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p 127.0.0.1:56433:5432 --tmpfs /var/lib/postgresql/data:rw \
  postgres:16.15@sha256:1a6ab3f5345eb6dbe04a1349529caabdb0ab09293a09590fad07b2246bfa4b54 \
  -c fsync=off -c synchronous_commit=off -c full_page_writes=off
```

Tests connect to `postgresql://postgres@127.0.0.1:56433/postgres` (no secret; override with `TEST_DATABASE_URL`) and create one database per test file.

## Step 1.3 (2026-09-27): sign in, app shell, E2E harness

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| `@solana/wallet-standard-util` | 1.1.4 | 2026-09-27 | https://registry.npmjs.org/@solana/wallet-standard-util (dist-tag `latest`, published 2026-09-10) | Sign-In With Solana text (`createSignInMessageText`) and parser (`parseSignInMessage`) in `apps/web`; brings `@noble/curves` 1.9.7. Signatures are verified with `@solana/kit` (WebCrypto) |
| `@playwright/test` | 1.63.0 | 2026-09-27 | https://registry.npmjs.org/@playwright/test (dist-tag `latest`, published 2026-09-04) | `tests/e2e`. Browser: Chrome for Testing 153.0.8010.12 (playwright chromium v1243) and its headless shell, installed with `playwright install chromium` into `~/Library/Caches/ms-playwright`. Since step 3.1 also Firefox 155.0 (playwright firefox v1543, `playwright install firefox`) for the landing's check without scroll timelines; WebKit 26.6 (playwright webkit v2359) was used once for the founder's review screenshots, not in CI |
| Geist, Geist Mono | variable fonts from Google Fonts through `next/font/google` | 2026-09-27 | next 16.3.6 `dist/compiled/@next/font/dist/google/font-data.json` (both listed, weights 100 to 900 and variable) | Downloaded at build time; the design loads Geist 300 to 700 and Geist Mono 400 and 500 |

Commands:

```sh
pnpm build && scripts/db-local.sh test-up && pnpm --filter @sotto/e2e e2e   # E2E against the production build
```

## Step 1.4 (2026-09-27): organizations, admin review, worker job loop

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| `@sotto/db` and `drizzle-orm` in `apps/worker` | workspace, 0.45.3 (catalog) | 2026-09-27 | `pnpm-workspace.yaml` catalog, lockfile `apps/worker` importer | New direct worker dependencies for the `sas-issue` job; no new package versions in the lockfile |
| ISO 3166-1 country list | Debian iso-codes `data/iso_3166-1.json` at commit `d055275324963c9bce5882eaaa93024cf2bf7ed0` (2023-02-22, the latest commit touching the file on `main` when read), SHA-256 `f01b812b57fba9f31ff621bf33e7c7570a01964dbeb5be2167e94decf538c89f` | 2026-09-27 | https://salsa.debian.org/iso-codes-team/iso-codes | Generated into `apps/web/lib/countries.ts`: 249 alpha-2 codes, `common_name` where present, else `name` |

Commands:

```sh
pnpm --filter @sotto/worker start                 # the job loop, reads apps/worker/.env.local
pnpm --filter @sotto/worker start -- --once        # each job once, exit 1 if one failed
scripts/db-local.sh test-up && SOTTO_LOCALNET_RPC_URL=http://127.0.0.1:8899 pnpm --filter @sotto/worker test:localnet   # every *localnet* test file of the worker; needs the validator and the test Postgres
```

## Step 1.5 (2026-09-27): browser crypto, key unlock, viewing keys

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| `libsodium-wrappers-sumo` | 0.8.4 | 2026-09-27 | https://registry.npmjs.org/libsodium-wrappers-sumo (dist-tag `latest`, published 2026-04-19) | `packages/sdk`: the viewing key (`crypto_box_seed_keypair`, 06 section 2); step 1.8 adds sealed boxes. Ships its own types (`dist/modules-sumo-esm/libsodium-wrappers.d.mts`). Brings `libsodium-sumo` 0.8.4 (published 2026-04-19) |
| `@sotto/sdk` and `@solana/kit` in `tests/e2e` | workspace, 8.3.0 (catalog) | 2026-09-27 | lockfile `tests/e2e` importer | The keys spec derives the expected secrets in Node |
| `spl-token-cli`, `solana-keygen`, `spl-token-wrap-cli` (this machine) | 5.6.1, 4.2.2, 2.0.0 | 2026-09-27 | `--version` | Used for the step 1.5 CLI key check and the recovery guide commands (facts A11, H7, H8) |

Commands:

```sh
pnpm --filter @sotto/sdk exec vitest run keys           # derivation, key match, viewing key, registration
pnpm build && scripts/db-local.sh test-up && pnpm --filter @sotto/e2e e2e   # includes the keys spec
```

## Step 1.6 (2026-09-27): transaction rules, startup verification, localnet bootstrap

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| `@solana-program/token` | 0.16.1 | 2026-09-27 | https://registry.npmjs.org/@solana-program/token (published 2026-09-01) | The USDC-like SPL Token mint of `scripts/bootstrap-localnet.ts`. Already in the lockfile through `@solana-program/token-wrap` 2.7.1 (`^0.16.1`); 0.17.0 (2026-09-21) is newer but token-wrap does not use it |
| `@solana-program/system` in `packages/sdk` and `scripts` | 0.15.0 (catalog) | 2026-09-27 | lockfile importers | System program errors (`getSystemErrorMessage`), transfers and account creation |
| `@sotto/scripts` (workspace package `scripts/`) | 0.0.0 | 2026-09-27 | `pnpm-workspace.yaml` | Dependencies: `@sotto/sdk`, `@solana/kit`, `@solana-program/system`, `@solana-program/token`, `typescript` (the AC checker's title reader) |
| Patched `spl-token-wrap-cli` 2.0.0, built by `scripts/build-token-wrap.sh --cli` | 2.0.0 | 2026-09-27 | crate SHA-256 `001a5dc00c23fad0054e58b8cfd3c05be487100779d8a596d5427321c15b13c2`, cargo 1.98.1, `--locked` | Binary `.cache/token-wrap/cli/target/release/spl-token-wrap`, SHA-256 on this machine `ff5f8174265bd6c115dfb5402efafaf87b2ab6e8bbdf34b7f0bbb060f9e3cf85` (not reproducible across machines); derives the devnet wUSDC mint |

Commands:

```sh
scripts/localnet.sh &  node scripts/bootstrap-localnet.ts          # localnet mints, escrow and SAS (.localnet/bootstrap.json)
SOTTO_LOCALNET_RPC_URL=http://127.0.0.1:8899 pnpm --filter @sotto/sdk test:localnet       # transaction rules, startup verification
SOTTO_LOCALNET_RPC_URL=http://127.0.0.1:8899 pnpm --filter @sotto/scripts test:localnet   # recover-balance (needs spl-token)
node scripts/recover-balance.ts --keypair <file> --mint <mint> --url devnet
node scripts/sas-close-attestation.ts --owner <wallet>                                     # devnet only, asks for confirmation
scripts/build-token-wrap.sh --cli                                                          # patched Token Wrap CLI
python3 -m unittest discover -s scripts/checks -p "test_*.py"                              # AC checker tests
```

## Step 1.7 (2026-09-27): account setup, funding and balances

No new package versions: every addition comes from the catalog.

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| `@solana-program/token` in `packages/sdk` | 0.16.1 (catalog) | 2026-09-27 | lockfile importers | Decodes SPL Token accounts and mints (public USDC balance, the USDC mint's decimals) and funds localnet wallets in `@sotto/sdk/testing/localnet` |
| Database migration | `0002_token_account_apply_flag` | 2026-09-27 | `packages/db/migrations` (drizzle-kit 0.31.11 generate) | `token_accounts.apply_flagged_at` |
| New SDK entries | `@sotto/sdk/confidential/public`, `@sotto/sdk/testing`, `@sotto/sdk/testing/localnet` | 2026-09-27 | `packages/sdk/package.json` | The public entry loads no WASM; the testing entries are for tests only |

Commands:

```sh
scripts/localnet.sh &  node scripts/bootstrap-localnet.ts                                  # fresh validator and bootstrap
SOTTO_LOCALNET_RPC_URL=http://127.0.0.1:8899 pnpm --filter @sotto/sdk test:localnet       # confidential account ACs through the wallet path
SOTTO_LOCALNET_RPC_URL=http://127.0.0.1:8899 pnpm --filter @sotto/worker test:localnet    # includes pending-credits
pnpm build && scripts/db-local.sh test-up && pnpm --filter @sotto/e2e e2e:localnet        # browser flows on localnet (fresh validator)
```

## Step 1.8 (2026-09-27): recipients, invites and the disclosure engine

No new package versions: sealed boxes use `libsodium-wrappers-sumo` 0.8.4 from step 1.5 (facts I6).

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| Database migration | `0003_invite_recipient` | 2026-09-27 | `packages/db/migrations` (drizzle-kit 0.31.11 generate) | `invites.recipient_id` with its index and the checks `invites_token_sha256` and `invites_recipient_role` |
| New SDK entries | `@sotto/sdk/disclosure`, `@sotto/sdk/disclosure/seal` | 2026-09-27 | `packages/sdk/package.json` | The first has no libsodium (servers and pages); the second holds the sealed boxes and is loaded by the crypto worker |

Commands:

```sh
pnpm --filter @sotto/sdk exec vitest run disclosure                                        # canonical JSON, payload, sealed boxes, manifests
scripts/localnet.sh &  node scripts/bootstrap-localnet.ts                                  # fresh validator and bootstrap
SOTTO_LOCALNET_RPC_URL=http://127.0.0.1:8899 pnpm --filter @sotto/worker test:localnet    # includes recipient-readiness
pnpm build && scripts/db-local.sh test-up && pnpm --filter @sotto/e2e e2e:localnet        # includes the recipients spec (fresh validator)
```

## Step 1.9 (2026-09-28): single confidential payment

No new package versions: `@solana-program/record` 0.5.0 (the Record program client) is used through `@solana-program/token-2022` 0.19.0, which depends on it; Sotto imports none of it directly.

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| Database migration | `0004_payment_execution` | 2026-09-28 | `packages/db/migrations` (drizzle-kit 0.31.11 generate) | `payments.created_by`, `payments.private_blob`, `payment_attempts.transfer_signature`, the `cluster_health` table |
| New SDK entry | `@sotto/sdk/approvals` | 2026-09-28 | `packages/sdk/package.json` | The approval message and contents hash (D-04), no WASM |
| SPL Record program on localnet | `recr1L3PCGKLbckBqMNcJhuuyU1zgo8nBhfLVsJNwr5`, cloned from devnet | 2026-09-28 | `scripts/localnet.sh` (`--clone-upgradeable-program`) | Version 0 confidential transfers stage the range proof in a record account (facts H9) |

Commands:

```sh
scripts/localnet.sh &  node scripts/bootstrap-localnet.ts                                  # fresh validator and bootstrap
SOTTO_LOCALNET_RPC_URL=http://127.0.0.1:8899 pnpm --filter @sotto/sdk test:localnet       # includes the transfer and its forced failure
SOTTO_LOCALNET_RPC_URL=http://127.0.0.1:8899 pnpm --filter @sotto/worker test:localnet    # includes proof-program-health
pnpm build && scripts/db-local.sh test-up && pnpm --filter @sotto/e2e e2e:localnet        # includes the payments spec, with the worker running
```

## Step 2.6 (2026-09-29): the indexer's pruned cursor and the local ledger size

No new package versions.

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| Database migration | `0008_indexer_cursor_slot` | 2026-09-29 | `packages/db/migrations` (drizzle-kit 0.31.11 generate) | `token_accounts.indexed_slot`, the slot of the index-accounts cursor |
| Local validator ledger size | `--limit-ledger-size 200000` | 2026-09-29 | `scripts/localnet.sh`; `solana-test-validator --help` 4.2.2 (default 10000 shreds in root slots) | With the default, a full e2e run outlived the oldest transactions and the indexer's cursor was pruned (facts M5) |

## Step 2.7 (2026-09-29): sotto_proofs on devnet

Resolved with `cargo update -p sotto_proofs` against the crates `spl-token-2022` 11.1.0 resolves (D-16), then pinned exactly in `programs/sotto_proofs/Cargo.toml`. The G4 probe (`programs/g4_probe`) left the workspace.

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| `sotto_proofs` dependencies | `bytemuck` 1.25.2, `solana-account-info` 3.1.1, `solana-address` 2.8.0, `solana-clock` 3.2.1, `solana-cpi` 3.1.0, `solana-define-syscall` 4.0.1, `solana-instruction` 3.5.1, `solana-program-entrypoint` 3.1.1, `solana-program-error` 3.0.1, `solana-rent` 3.1.0, `solana-sdk-ids` 3.1.0, `solana-sha256-hasher` 3.1.0, `solana-system-interface` 3.3.0, `solana-sysvar` 3.1.1, `solana-zk-elgamal-proof-interface` 0.1.3, `solana-zk-sdk-pod` 0.1.2, `spl-token-2022-interface` 3.1.2, `spl-token-confidential-transfer-ciphertext-arithmetic` 0.5.1 | 2026-09-29 | crates.io, Cargo.lock | `bytemuck` moved from the G4 pin 1.25.0 to 1.25.2, which `solana-runtime` 4.3.0 requires. Off chain builds add the `curve25519` feature of `solana-address` (the PDA functions; onchain they are syscalls) |
| `sotto_proofs` dev-dependencies | `solana-program-test` 4.3.0 (feature `agave-unstable-api`), `spl-token-confidential-transfer-proof-generation` 0.6.1, `solana-zk-sdk` 7.0.1, `proptest` 1.11.0, `tokio` 1.53.1, `solana-account` 4.7.0, `solana-keypair` 3.1.2, `solana-signer` 3.0.1, `solana-signature` 3.6.0, `solana-transaction` 4.3.0, `solana-transaction-error` 3.4.0, `solana-instruction-error` 2.5.0, `solana-program-pack` 3.1.0, `solana-system-interface` 3.3.0 (feature `bincode`), `serde_json` 1.0.151 | 2026-09-29 | crates.io, Cargo.lock | `solana-program-test` 4.2.2 and LiteSVM 0.17.0 conflict with `solana-address` 2.8.0 (facts N3). The runtime's ZK ElGamal Proof program in 4.3.0 is on `solana-zk-sdk` 7.0.1, as the proof generation crate is |
| Codama | `@codama/nodes` 1.11.0, `@codama/visitors-core` 1.11.0, `@codama/renderers-js` 2.5.0 | 2026-09-29 | https://registry.npmjs.org (dist-tag `latest`) | devDependencies of `@sotto/scripts` (catalog). The renderer uses `@solana/codecs-strings` ^8 and writes a kit 8 client with `rootOnly` imports (`@solana/kit`, `@solana/kit/program-client-core`) |
| New SDK entry | `@sotto/sdk/proofs` | 2026-09-29 | `packages/sdk/package.json` | The generated client plus the proof of funds helpers (06 section 8) |
| `sotto_proofs` on devnet | program `4rMKgJWgawaTTdUxaudUXthEExnRZ7AvFvqzsoEAr9jd`, config `Gxhkhq4QDvv2y2GK7ZjHF1J8rThwsSdfxDziMCdWFnFe` | 2026-09-29 | `scripts/deploy-program.sh`, `scripts/init-proofs-config.ts` | 44360 bytes, SHA-256 `63c4002c3db312f82632ba7723725b906c30b9833593cb5de723d6cab92f32d8`, `--max-len` 133120, upgrade authority wallet A, slot 505623980 (facts N1) |

Commands:

```sh
pnpm program:build && pnpm program:test                      # the SBF v3 build, then the Rust tests (they load target/deploy/sotto_proofs.so)
pnpm --filter @sotto/scripts generate:proofs-client          # the IDL JSON and the generated client, from scripts/proofs-idl.ts
scripts/deploy-program.sh --cluster devnet                   # dry run: every check and the cost; --yes deploys
node scripts/init-proofs-config.ts --cluster devnet          # the config for the devnet wrapped mint
node scripts/proof-of-funds-devnet.ts                        # one real proof of funds from a throwaway owner
SOTTO_LOCALNET_RPC_URL=http://127.0.0.1:8899 pnpm --filter @sotto/sdk test:localnet   # includes proofs-localnet (after the bootstrap deployed the program)
```

## Step 2.8 (2026-09-30): proof of funds and the public verification page

No new package versions.

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| Database migration | `0009_proof_records` | 2026-09-30 | `packages/db/migrations` (drizzle-kit 0.31.11 generate) | The `proof_records` table of 08 section 2 with checks for the address, the 16 byte salt, a positive threshold and the label length |
| New SDK entries | `@sotto/sdk/attestation`, `@sotto/sdk/proofs/plan` | 2026-09-30 | `packages/sdk/package.json` | The business attestation reader without sas-lib (D-24); the balance threshold proofs, split from `@sotto/sdk/proofs`, which now loads no cryptography |
| Web server variables | `LOCALNET_SOTTO_PROOFS_PROGRAM`, `LOCALNET_SAS_CREDENTIAL`, `LOCALNET_SAS_SCHEMA` | 2026-09-30 | `apps/web/lib/server/cluster.ts`, `tests/e2e/server.ts` | Localnet only, server only |

Commands:

```sh
pnpm build && scripts/db-local.sh test-up && pnpm --filter @sotto/e2e exec playwright test --config playwright.localnet.config.ts localnet/proofs.spec.ts   # after localnet.sh and the bootstrap
```


## Step 3.10 (2026-10-01): accessibility and Lighthouse

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| `@axe-core/playwright` | 4.13.0 | 2026-10-01 | https://registry.npmjs.org/@axe-core/playwright (dist-tag `latest`, published 2026-08-11) | `tests/e2e/a11y.ts`, the named export `AxeBuilder` (the default export is not a constructor in this build). Depends on `axe-core` `~4.13.0`, resolved to 4.13.0 (published 2026-08-05) |
| `lighthouse` | 13.5.0 | 2026-10-01 | https://registry.npmjs.org/lighthouse (dist-tag `latest`, published 2026-09-18) | `tests/e2e/specs/lighthouse.spec.ts`, ESM default export and the desktop preset `lighthouse/core/config/desktop-config.js`. Needs Node 22.19 or later (its `engines`); the project runs Node 24.21.0 |

Commands:

```sh
pnpm build && pnpm --filter @sotto/e2e exec playwright test specs/lighthouse.spec.ts specs/keyboard.spec.ts
SOTTO_A11Y_REPORT=1 pnpm --filter @sotto/e2e e2e:localnet   # lists every axe violation and console problem instead of failing at the first
```

## Step 4.2 (2026-10-02): hosting on sottoapp.xyz (D-28)

| Item | Version | Resolved on | Source | Notes |
|---|---|---|---|---|
| Node.js base image | `node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6` | 2026-10-02 | Docker Hub (`docker buildx imagetools inspect`; `NODE_VERSION=24.21.0` in its config) | The hosted web and worker images; pnpm 12.6.0 through corepack and the root `packageManager` |
| PostgreSQL image | `postgres:16.15-bookworm@sha256:efedf3595f1d6f415c08568ba171029bf54052e754cc9f030e3f2412b21f3d67` | 2026-10-02 | Docker Hub tag `16.15-bookworm` (`PG_VERSION=16.15-1.pgdg12+2`, updated 2026-09-19) | The hosted database; the backup's restore test |
| cloudflared image | `cloudflare/cloudflared:2026.9.3@sha256:072c067d25ccbe61d46e18f0d0723255f2bb5304f7317caa95b27031520ff92c` | 2026-10-02 | Docker Hub: the tags `2026.9.3` and `latest` share this digest (2026-09-24) | The hosted tunnel client; runs as 65532 (distroless) |
| age | v1.3.2 | 2026-10-02 | https://github.com/FiloSottile/age/releases/tag/v1.3.2 (2026-08-29); SHA-256 from the release's asset digests: linux-amd64 `cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10`, darwin-arm64 `e2020b073c44f692685a24d6abc378817eb81ffaaf49fd0531ef8565f767f2f5` | On the server (encrypts the backups) and on the founder's machine (the key and the restore); never in the repository |
| Database migration | `0012_review_notification` | 2026-10-02 | `packages/db/migrations` (drizzle-kit generate) | `orgs.review_notified_at` for the `review-notify` job |

Commands:

```sh
pnpm deploy:hosted [--skip-ci-check] [--no-external] | --rollback   # an operator command (scripts/ops.sh)
```
