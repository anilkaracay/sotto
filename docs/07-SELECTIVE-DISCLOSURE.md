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
- Recipient private blobs (step 1.8): the default amount and notes of a recipient are the canonical JSON `{ "v": 1, "default_amount": "<base units or null>", "notes": "<text or null>" }` (notes at most 500 characters without control characters, checked before sealing, so the box stays under 2048 bytes and opens again) sealed with `crypto_box_seal` to the owner's own viewing key, after the owner's browser verified that key's registration signature (I-8). The server stores the box (`recipients.private_blob`, 48 to 2048 bytes) and cannot open it; the recipients page opens it only in the owner's tab.

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

Balance snapshots (step 2.12, AC-05.2): a `balance_snapshot` payload carries a 15th field, `"pending": "<base units>"`, and no other kind may; its `amount` is the decrypted available balance and `pending` the decrypted pending balance of the owner's wUSDC account, `subject` is the UTC day (`YYYY-MM-DD`), `created_at` the moment it was taken, and it has no flow fields: `direction` `in`, `category` `other`, `memo`, `gross`, `tax` and `counterparty` null, `signatures` empty. `validatePayload` refuses a snapshot without `pending`, with another subject or with a flow field.

Implementation (step 1.8, `validatePayload`): exactly these 14 fields, nothing else; `amount`, `gross` and `tax` are base units as decimal strings of at most 20 digits; `subject` 1 to 100 characters, `memo` at most 500, `counterparty` at most 200; at most 64 base58 transaction signatures; `created_at` an ISO 8601 UTC time. `sealPayload` validates before sealing and `openPayload` after opening.

Incoming payments ("Money in"; Post-hackathon, founder 2026-09-29, plan move M1: the hackathon build writes no `direction: "in"` disclosures, so Books and the balance history show money out and public flows only): the worker stores, for each incoming confidential transfer, the raw destination ciphertext bytes (public data, allowed; `chain_activity.destination_ciphertext` in `08-BACKEND.md`). On unlock, the owner's worker decrypts them (lo 16 bits, hi 32 bits) and writes `payment` self disclosures with `direction: "in"`. Gate G3 measures decryption time; if above 2 seconds per transfer on the reference laptop, fall back to an aggregate "received since last unlock" from the AES balance delta at apply time, and stop showing per payer revenue.

## 4. Authenticity: signed manifests

A viewer must know a disclosure really came from the org owner.
- Each time the owner's browser creates disclosures (after a payment, a payroll run, a grant back fill, a month total), it builds a manifest: canonical JSON `{ "v":1, "org":..., "items":[{ "id":..., "viewer":..., "sha256_ciphertext":... }], "created_at":... }`.
- The owner wallet signs `sotto-disclosure-manifest/v1\n` plus SHA-256 of the manifest (one `signMessage` per batch).
- Payroll runs: one manifest per chunk (`06-CONFIDENTIAL-FLOWS.md` section 7), signed after the chunk settles; an interrupted run signs a manifest for its settled lines on resume. Implementation (step 2.3): once a chunk's last transfer is finalized, the page writes a `payroll_line` item per line for the owner and, when the recipient registered a viewing key that verifies (I-8), for the recipient (grant null), with the payload `category` `payroll`, the line's amount, memo, gross and tax, the recipient's name as counterparty and the transfer signature; a stopped chunk does it for the lines that landed. The run's view says which lines have the owner's item; Resume, and the run page's "Save the records" action, write the missing ones under one manifest. The recipient's pay page lists them with the payments received. Since step 2.4 each line's items also go to every grant that covers it (section 7).
- One manifest per chunk stays (founder request of step 2.3.1, 2026-09-29: one manifest per run, checked against X-33, I-9 and the disclosure tests, not changed because it weakens a guarantee). A chunk's records are signed as soon as the chunk settles, so a run that stops (a closed tab, a failed line, a declined prompt) leaves at most one chunk's lines without records until Resume or "Save the records". With one manifest per run, every settled line would stay without the owner's record, the recipient's payslip (AC-08.6) and the records of the grants that cover it (AC-06.4) until the run ends or is resumed: a run left after 20 of its 24 lines would hold 20 paid lines that nobody can read in Sotto, the window X-33 closes. A manifest also holds at most 500 items, and a run's items are its lines times the owner, the recipient and every covering grant: 100 lines with the recipients' keys and two accountants' grants are 400 items, so a larger run would need more than one manifest anyway. The saving would be every manifest signature after the first. For a 24 line run: with a version 1 wallet, 6 prompts now (3 transaction batches of 10, 10 and 4 lines and 3 manifests) against 4; with a version 0 wallet, 17 now (11 transaction prompts: the first line's 5 transactions one at a time, lines 2 to 4 in one call, then 5 chunks of 4 lines; and 6 manifests) against 12.
- Back fill (step 2.4, AC-10.3): the viewing keys page asks `GET /orgs/:id/grants/:gid/backfill` for at most 500 of the owner's own records in the grant's scope that the grant has no item for, verifies each against the owner's manifest (I-9), opens it with the viewing key in the tab, seals the same payload to the holder's viewing key once its registration verifies (I-8), and stores the batch under one manifest the owner signs; it asks again until nothing is left, so a back fill of up to 500 records is one signature and each further 500 one more. The server stores the new items only for the grant's viewer and only for records its scope covers (08 section 3), and never sees a payload.
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
| `all_payments` | `payment` and `payroll_line` items for every payment, plus `balance_snapshot` (Post-hackathon: see below) |
| `period` (from, to) | same as above, limited to payments settled in the period |
| `payroll_only` | `payroll_line` items |
| `totals_only` (Post-hackathon, D-27) | `month_total` items (sum of outgoing, sum of incoming, payroll total) and `balance_snapshot` |
| `own_payslips` | `payroll_line` items where the viewer is the recipient |
| Owner self | every item, always (this is the owner's own history and the source for back fill and charts) |

Implementation (step 1.8): `scopeAllowsKind` holds the kinds of this table. The server stores an item without a grant for the owner (any kind) and for a current recipient of the org when it is a `payment` or a `payroll_line`: the recipient disclosure of AC-06.4 (Phase 1, step 1.9) and the payslips of AC-12.1; any other item needs an `active` grant of this org for that viewer whose scope covers the kind (08 section 3). The rest of the evaluation, a period's payments and the lines that are the viewer's own, needs payments and comes with them (step 1.9 and the grants of step 2.3).

Implementation (step 2.4, `scopeCovers` and `periodBounds` in `packages/sdk/src/disclosure/scope.ts`): a grant covers an item when its scope allows the kind, when for `own_payslips` the line is the viewer's own, and when for `period` the payment settled at or after the first day at 00:00 UTC and before the day after the last day at 00:00 UTC (both days included, by `payments.settled_at`, which the worker sets at finality; a payment whose records are written right after its transfer finalized counts as settled then). The server checks every item of a grant this way against the payment it names, which must be settled or executing and of the item's kind (a `payment` item a single payment, a `payroll_line` item a payroll line), and a grant that is not active or whose expiry passed covers nothing; an item without a grant for a recipient must be about a payment to that recipient (08 section 3). The owner's browser picks the covering grants with the same function.

**In the hackathon build, balance snapshots go to the owner only (founder, 2026-09-30; D-27): grant holders do not receive `balance_snapshot` items yet, whatever their scope,** so `all_payments` and `period` grants receive `payment` and `payroll_line` items only. The server refuses a snapshot item with a grant or for anyone but the owner (422 `disclosure_not_allowed`); back fill never offers snapshots.

Balance history for charts: the owner's browser writes a `balance_snapshot` self disclosure at most once per UTC day when the owner unlocks keys, under a signed manifest. The chart combines snapshots with public deposit and withdraw amounts from chain. Implementation (step 2.12, AC-05.2): the snapshot is written on the overview, where the chart is, as soon as the owner's keys are unlocked there (an unlock on another page of the tab counts on the next overview visit, as the keys stay open across the tab's pages): the page asks for today's snapshot, and without one it verifies the owner's own viewing key registration (I-8), seals the decrypted available and pending balances to that key in the crypto worker and stores the item under a manifest the owner wallet signs, one signature a day (`lib/client/balance-snapshot.ts`). The balances never leave the tab in plaintext. The server keeps at most one per org, owner and day (a unique index, migration 0010; 409 `snapshot_exists`) and takes a day within one day of its own UTC date (422 `snapshot_date`). The overview's balance growth card then reads the owner's snapshots from the month before the six month window on, verifies and opens them in the tab, and adds the public deposits and withdrawals of `chain_activity` (`lib/balance-history.ts`, rules in 09 section 3).

Post-hackathon with `totals_only` (D-27): `month_total` items are written on the owner's first unlock after month end (final) and refreshed on each unlock during the current month (provisional, flagged).

## 7. Lifecycle

- **Create grant:** grants are always created through an invite: the owner selects the scope and invites the viewer; the viewer accepts, becomes a user, registers a viewing key, and the grant activates. When the grant activates, the owner's browser back fills: decrypts the owner's self items in scope, re-encrypts to the viewer, uploads with a signed manifest. Implementation (step 2.4, X-37, AC-10.1 to AC-10.3): the viewing keys page's Grant a key drawer names the holder (a name and an optional role), what they can read (`all_payments`, `period` with its first and last day, `payroll_only`) and the expiry (30 days, the end of the quarter, the end of the year, or No expiry, X-52; in UTC), and shows the invite link once (7 days, like a recipient's). The holder opens it, signs in with their own wallet and accepts: they become the org's `accountant` (read only) and the grant's viewer, and the grant is `active` at once when they have a viewing key, otherwise `pending_viewer_key` until they create it on the same page. The owner's wallet cannot accept its own org's invite. A grant revoked or expired before acceptance withdraws its invite; one not yet accepted can get a new link, which replaces the old one. Once the grant is active, the keys page offers Share past records, the back fill of section 4; it needs the owner's keys unlocked in the tab and one signature per 500 records.
- **Recipient invite:** accepting a recipient invite automatically creates an `own_payslips` grant for that recipient. Implementation (step 1.8, `POST /invites/:token/accept`): the grant is `active` when the recipient already has a viewing key and `pending_viewer_key` until they register one.
- **New payment:** after settlement, the owner's browser evaluates every active grant and creates the items. Implementation (step 1.9, AC-06.4 Phase 1 part): after the transfer is finalized, the payment page writes the owner's self disclosure and the recipient's disclosure of the payment (kind `payment`, direction `out`, the category chosen, the payment id as subject, the transfer signature), each sealed to a registered viewing key whose registration signature verified (I-8), in one manifest the owner wallet signs; a recipient without a viewing key gets none. Grant items join with step 2.3. Implementation (step 2.4, AC-06.4 grant part): before the payment's and each payroll chunk's manifest, the page reads the org's grants and keeps the active ones, other than own payslips, whose holder's viewing key registration verifies (I-8); each record goes to every grant whose scope covers it, sealed to the holder's key, in the same manifest as the owner's and the recipient's. A payroll line is covered by its settlement time when Sotto holds it (a line saved later with "Save the records"), otherwise by the time of writing. The server checks with the settlement time it holds, so at a period's boundary, or with the device's clock off, it can refuse a grant's item and with it the batch (`disclosure_not_allowed`); the page then signs the batch again without the grants' items, keeping the owner's and the recipients' records, and says "No copy was saved for the keys you granted; Viewing keys shows the records to share." (also when the grants cannot be read); Share past records adds them with the server's times (`apps/web/lib/client/records.ts`). A settled payment whose records cannot be saved stays a settled payment, with the record's problem next to the result.
- **Expire:** the worker deletes disclosures of grants past expiry and marks them `expired`. Implementation (step 2.4, `grant-expiry`, 08 section 4): every hour, a grant `active` or `pending_viewer_key` whose expiry passed becomes `expired` and its records are deleted in the same transaction, logged as `grant_expired`. Between two runs the API already treats it as expired: it takes no new item for it, returns none of its items, lists it as expired, and a viewing key registered for it does not activate it.
- **Revoke:** the API deletes all disclosures of the grant in the same transaction as setting `revoked_at`. The viewer app never persists decrypted data to disk or browser storage, so a reload removes access. The UI must state: "Revoking stops access from now on. It cannot erase what was already viewed." Implementation (step 2.4, AC-10.4): the keys table's toggle opens that sentence with Keep and Revoke; `POST /orgs/:id/grants/:gid/revoke` locks the grant, deletes its records and sets `revoked` and `revoked_at` in one transaction, logged as `grant_revoked` with the number of records deleted. A recipient's own payslips follow their recipient record and are not revoked there.

## 8. Integrity against chain

- Recipient: on demand, with a "Verify against chain" button (not automatically), decrypts the stored destination ciphertext of the transfer (section 3) with their own ElGamal secret and compares it with the disclosure.
- Owner: compares each self disclosure with the decrypted balance delta of the corresponding settlement.
- Accountant and board: rely on the owner's signed manifest. The UI labels these numbers "Shared by <owner name>". Implementation (step 2.5, Books): every record is verified against the owner's manifest before it opens (I-9), one that does not verify is counted in a warning and not opened, and the scope banner says "Shared by <owner>" with what the grant reads and until when.

## 9. Tests

- Round trip encrypt and decrypt for every kind.
- Manifest signature verification, including tampered item, wrong signer, replayed manifest for another org.
- Scope evaluation table tests for every scope and boundary dates (inclusive from, exclusive to, UTC).
- Revocation deletes rows and a subsequent fetch returns nothing.
- Server substitution attack: registration with a mismatched signature is rejected by the client.
- Where (step 2.4): the scope tables with the period's boundary days in `packages/sdk/test/disclosure.test.ts`; the server's scope checks and the read filter in `apps/web/test/api-disclosures.test.ts`; creation, acceptance, back fill, revocation and the access log in `apps/web/test/api-grants.test.ts`; expiry in `apps/worker/test/grant-expiry.test.ts`; the whole flow in the browser, from the invite to an empty fetch after revocation, in `tests/e2e/localnet/grants.spec.ts`.
