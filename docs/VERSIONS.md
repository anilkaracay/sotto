# Versions

Every pinned tool, crate and package, with the date it was resolved.

| Component | Version | Resolved on | Source | Notes |
|-----------|---------|-------------|--------|-------|
| Host | macOS 26.6.2 (25G83), arm64, Apple M5 | 2026-09-26 | `sw_vers`, `uname -m` | Development machine, not pinned |
| Agave CLI suite (`solana`, `solana-test-validator`, `solana-keygen`, `agave-install`) | 4.2.2 (src `e29e5d91`, feat `21b0d33a`, client Agave, channel stable) | 2026-09-26 | https://release.anza.xyz/stable/solana-release-aarch64-apple-darwin.tar.bz2 · https://github.com/anza-xyz/agave/releases/tag/v4.2.2 | `e29e5d9` is tag `v4.2.2` (`c9c6f32`) plus one CI only backport commit. `agave-install info`: "Install is up to date". v1 transactions locally need Solana CLI v4.2+ (see VERIFICATION-LOG G0) |
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
