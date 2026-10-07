#!/usr/bin/env bash
# Invariant I-4 (docs/10-SECURITY.md): the deprecated ZK Token Proof program is never referenced.
# Allowed only in docs/02-VERIFIED-FACTS.md (fact B4) and this script. Everything else tracked, including lockfiles, must not contain the ID.
set -euo pipefail

ID="ZkTokenProof1111111111111111111111111111111"
matches="$(git grep -n -F "$ID" -- . \
  ':(exclude)docs/02-VERIFIED-FACTS.md' \
  ':(exclude)scripts/checks/no-zk-token-proof.sh' || true)"
if [[ -n "$matches" ]]; then
  echo "$matches"
  echo "FAILED: the deprecated ZK Token Proof program ID is referenced (invariant I-4)"
  exit 1
fi
echo "ok: the ZK Token Proof program ID appears only in the allowed files"
