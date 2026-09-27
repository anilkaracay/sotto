# 07 · Selective disclosure (viewing keys)

## 1. Why this exists

Onchain confidential keys are wallet wide (facts A11) and the wrapped USDC mint has no auditor (D-01). So scoped, expiring and revocable read access must be built at the application layer. The server stores only ciphertexts it cannot decrypt.

## 2. Cryptography

- Library: libsodium (`libsodium-wrappers-sumo` in the browser, pinned; 0.8.4 since step 1.5, where the viewing key derivation needs it).
- Viewer keypair: X25519, derived from a wallet signature (see `06-CONFIDENTIAL-FLOWS.md` section 2).
- Encryption: `crypto_box_seal(plaintext, viewerPublicKey)` (anonymous sender, authenticated by the manifest in section 4).
- Hashing: SHA-256.
- Encodings: hashes are lowercase hex; base64 is RFC 4648 standard alphabet with padding.
- Canonical JSON: keys sorted, UTF-8, no insignificant whitespace (implement once in `packages/sdk/src/disclosure/canonical.ts` with tests).
- Implementation (step 1.8): the engine is `packages/sdk/src/disclosure/`. `@sotto/sdk/disclosure` holds canonical JSON, the payload, manifests and the scope table and has no libsodium, so servers import it; `@sotto/sdk/disclosure/seal` holds the sealed boxes (`sealJson`, `openJson`, `sealPayload`, `openPayload`) and only the tab's crypto worker loads it (requests `seal` and `openSealed`; opening needs the viewing key unlocked in that tab). Canonical JSON sorts keys by UTF-16 code units (every key Sotto uses is ASCII) and accepts only strings, safe integers, booleans, null, arrays and plain objects; anything else throws `CanonicalJsonError`, so amounts always travel as decimal strings. A sealed box is the plaintext plus 48 bytes (facts I6).
- Recipient private blobs (step 1.8): the default amount and notes of a recipient are the canonical JSON `{ "v": 1, "default_amount": "<base units or null>", "notes": "<text or null>" }` sealed with `crypto_box_seal` to the owner's own viewing key, after the owner's browser verified that key's registration signature (I-8). The server stores the box (`recipients.private_blob`, 48 to 2048 bytes) and cannot open it; the recipients page opens it only in the owner's tab.

## 3. Payload (version 1)

```json
{
  "v": 1,
  "org": "<org uuid>",
  "kind": "payment | payroll_line | month_total | balance_snapshot",
  "direction": "in | out",
  "category": "payroll | supplier | revenue | payouts | software | other",
  "subject": "<payment or line uuid, or YYYY-MM for totals, or ISO date for snapshots>",
  "amount": "<base units as decimal string>",
  "currency": "USDC",
  "memo": "<string or null>",
  "gross": "<base units or null>",
  "tax": "<base units or null>",
  "counterparty": "<display name or null>",
  "signatures": ["<tx signature>", "..."],
  "created_at": "<ISO 8601 UTC>"
}
```
No plaintext hash of the payload is ever stored (small amounts are brute forceable from a hash).

Implementation (step 1.8, `validatePayload`): exactly these 14 fields, nothing else; `amount`, `gross` and `tax` are base units as decimal strings of at most 20 digits; `subject` 1 to 100 characters, `memo` at most 500, `counterparty` at most 200; at most 64 base58 transaction signatures; `created_at` an ISO 8601 UTC time. `sealPayload` validates before sealing and `openPayload` after opening.

Incoming payments ("Money in"): the worker stores, for each incoming confidential transfer, the raw destination ciphertext bytes (public data, allowed; `chain_activity.destination_ciphertext` in `08-BACKEND.md`). On unlock, the owner's worker decrypts them (lo 16 bits, hi 32 bits) and writes `payment` self disclosures with `direction: "in"`. Gate G3 measures decryption time; if above 2 seconds per transfer on the reference laptop, fall back to an aggregate "received since last unlock" from the AES balance delta at apply time, and stop showing per payer revenue.

## 4. Authenticity: signed manifests

A viewer must know a disclosure really came from the org owner.
- Each time the owner's browser creates disclosures (after a payment, a payroll run, a grant back fill, a month total), it builds a manifest: canonical JSON `{ "v":1, "org":..., "items":[{ "id":..., "viewer":..., "sha256_ciphertext":... }], "created_at":... }`.
- The owner wallet signs `sotto-disclosure-manifest/v1\n` plus SHA-256 of the manifest (one `signMessage` per batch).
- Payroll runs: one manifest per chunk (`06-CONFIDENTIAL-FLOWS.md` section 7), signed after the chunk settles; an interrupted run signs a manifest for its settled lines on resume.
- Viewers verify the signature against the org owner address before trusting any item. Unsigned or invalid items are hidden and reported.
- Implementation (step 1.8, `packages/sdk/src/disclosure/manifest.ts`): each item gets a uuid in the browser, so the manifest names items before the server stores them. `buildManifest` hashes each exact ciphertext; `validateManifest` accepts exactly version 1 with uuids, lowercase hex hashes, unique item ids and 1 to 500 items; `manifestMessage` is the UTF-8 of `sotto-disclosure-manifest/v1\n` followed by the lowercase hex SHA-256 of the canonical manifest; `verifyManifest` checks that the manifest names the org and carries the owner wallet's Ed25519 signature (WebCrypto through `@solana/kit`); `itemInManifest` checks an item's id, viewer and ciphertext hash. The server runs all of them before it stores a batch (`POST /orgs/:id/disclosures`, 08 section 3), and the viewer's browser runs them again on what `GET` returns before it opens anything (I-9).

## 5. Viewer key registration

- A viewer registers `{ x25519_public_key, signature }` where the signature is by their wallet over `sotto-view-key-register/v1\n<base64 public key>`.
- Before encrypting to a viewer, the owner's browser verifies that signature. This prevents the server from substituting a key it controls.
- Rotation: registering a new key marks the old one `rotated`; the owner's browser re-encrypts active grant material on next open.
- Implementation (step 1.5): `POST /api/viewer-keys` and `GET /api/users/:id/viewer-key` (08 section 3); the check is `verifyViewKeyRegistration` from `@sotto/sdk/keys/public`, which the server runs before storing and the browser runs before using a key (tested against a key swapped in the database). Owners register their viewing key on the setup page; recipients do it in the invite flow (step 1.8, `/app/invite/[token]`), and the registration activates the grants that were waiting for their key.

## 6. What gets disclosed to whom

| Grant scope | Receives |
|-------------|----------|
| `all_payments` | `payment` and `payroll_line` items for every payment, plus `balance_snapshot` |
| `period` (from, to) | same as above, limited to payments settled in the period |
| `payroll_only` | `payroll_line` items |
| `totals_only` (Post-hackathon, D-27) | `month_total` items (sum of outgoing, sum of incoming, payroll total) and `balance_snapshot` |
| `own_payslips` | `payroll_line` items where the viewer is the recipient |
| Owner self | every item, always (this is the owner's own history and the source for back fill and charts) |

Implementation (step 1.8): `scopeAllowsKind` holds the kinds of this table. The server stores an item without a grant for the owner (any kind) and for a current recipient of the org when it is a `payment` or a `payroll_line`: the recipient disclosure of AC-06.4 (Phase 1, step 1.9) and the payslips of AC-12.1; any other item needs an `active` grant of this org for that viewer whose scope covers the kind (08 section 3). The rest of the evaluation, a period's payments and the lines that are the viewer's own, needs payments and comes with them (step 1.9 and the grants of step 2.3).

Balance history for charts: the owner's browser writes a `balance_snapshot` self disclosure at most once per day when the owner unlocks keys. The chart combines snapshots with public deposit and withdraw amounts from chain.

Post-hackathon with `totals_only` (D-27): `month_total` items are written on the owner's first unlock after month end (final) and refreshed on each unlock during the current month (provisional, flagged).

## 7. Lifecycle

- **Create grant:** grants are always created through an invite: the owner selects the scope and invites the viewer; the viewer accepts, becomes a user, registers a viewing key, and the grant activates. When the grant activates, the owner's browser back fills: decrypts the owner's self items in scope, re-encrypts to the viewer, uploads with a signed manifest.
- **Recipient invite:** accepting a recipient invite automatically creates an `own_payslips` grant for that recipient. Implementation (step 1.8, `POST /invites/:token/accept`): the grant is `active` when the recipient already has a viewing key and `pending_viewer_key` until they register one.
- **New payment:** after settlement, the owner's browser evaluates every active grant and creates the items.
- **Expire:** the worker deletes disclosures of grants past expiry and marks them `expired`.
- **Revoke:** the API deletes all disclosures of the grant in the same transaction as setting `revoked_at`. The viewer app never persists decrypted data to disk or browser storage, so a reload removes access. The UI must state: "Revoking stops access from now on. It cannot erase what was already viewed."

## 8. Integrity against chain

- Recipient: on demand, with a "Verify against chain" button (not automatically), decrypts the stored destination ciphertext of the transfer (section 3) with their own ElGamal secret and compares it with the disclosure.
- Owner: compares each self disclosure with the decrypted balance delta of the corresponding settlement.
- Accountant and board: rely on the owner's signed manifest. The UI labels these numbers "Shared by <owner name>".

## 9. Tests

- Round trip encrypt and decrypt for every kind.
- Manifest signature verification, including tampered item, wrong signer, replayed manifest for another org.
- Scope evaluation table tests for every scope and boundary dates (inclusive from, exclusive to, UTC).
- Revocation deletes rows and a subsequent fetch returns nothing.
- Server substitution attack: registration with a mismatched signature is rejected by the client.
