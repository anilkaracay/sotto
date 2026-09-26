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
