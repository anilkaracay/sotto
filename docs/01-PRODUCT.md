# 01 · Product

## 1. One sentence

Sotto is the business account for companies that pay in stablecoins: every payment settles on Solana, amounts are encrypted onchain, and the company decides who can read which numbers.

## 2. Roles

| Role | Who | Can do | Can read |
|------|-----|--------|----------|
| Owner | Company founder or finance lead. Holds the owner wallet. | Everything, including signing all money operations | Everything of the org |
| Approver | Another company member | Approve payroll runs and payments (D-04) on `/app/[org]/payroll/[run]`, seeing the contents hash they sign. With the default policy of 1, the initiator's execution is the approval (Q-11). Post-hackathon (D-27, Q-12): in the hackathon build the policy stays at 1, so the initiator's execution is the only approval and there is no approver screen | What their grant allows |
| Accountant | Internal or external | Read, reconcile, annotate, export within grant scope | Grant scope |
| Board viewer (Post-hackathon, D-27) | Board member or investor | Read totals and treasury balance within grant scope on the board screen `/app/[org]/board` | Totals only |
| Recipient | Employee, contractor, supplier | Configure their confidential account, read their own payslips, withdraw | Their own payments |
| Counterparty | Supplier, lender, landlord | Open a proof link and see the result | The proven statement only |
| Sotto admin | Sotto team | Review KYB, issue or revoke the verified business attestation | No customer amounts, ever |

A person can hold several roles in several orgs. Roles live on memberships, not on wallets.

## 3. Scope

**MVP (the hackathon build, devnet only; mainnet is Post-hackathon per D-01):** the scope of D-27: F-01 to F-15, F-17 and F-19, except where marked.
**Post-hackathon:** income proof (D-07), email claim (D-08), Squads (D-04), KYB provider (D-09), and per D-27: F-16 command palette, F-18 privacy score, AC-11.5 close checklist and the Close and export page, the board viewer role and route and the `totals_only` scope, reconciliation notes, the approver screen including the payroll run Approve action (AC-08.3, Q-12).
"Phase 0 to 4" means only the schedule in `12-MILESTONES.md`.

## 4. Features and acceptance criteria

Each acceptance criterion (AC) becomes at least one automated test. IDs are referenced from tests.

### F-01 Sign in
- AC-01.1 A user signs in with a Wallet Standard wallet using Sign-In With Solana; the server verifies the signature and creates a session cookie.
- AC-01.2 A replayed or expired sign in message is rejected.
- AC-01.3 Signing out invalidates the session server side.

### F-02 Organization onboarding and verification
- AC-02.1 A signed in user creates an org with legal name, country, registration number, website, contact email. The creator becomes Owner.
- AC-02.2 The org is `pending_review` until a Sotto admin approves it. Money features are disabled while pending.
- AC-02.3 On approval, the worker issues a SAS attestation (schema `sotto.business.v1`, see `08-BACKEND.md`) to the owner wallet and stores the attestation address. The org becomes `active`.
- AC-02.4 Revoking verification closes the attestation and sets the org to `suspended`; money features are disabled.

### F-03 Confidential account setup
- AC-03.1 The app checks that the wrapped USDC mint exists; if not, the owner can create it (permissionless) and the app records the address.
- AC-03.2 The owner derives confidential keys (scheme per D-03). Keys stay in memory in the browser tab and are never sent anywhere.
- AC-03.3 The app creates the owner's Token-2022 associated token account for wUSDC if missing and configures it for Confidential Balances, signed by the owner.
- AC-03.4 After setup, the app reads the account and shows public balance, pending (decrypted) and available (decrypted) balances.
- AC-03.5 Reloading the page shows the confidential balance as **Locked** until the owner unlocks keys again. It never shows zero for a locked balance.

### F-04 Fund the account
- AC-04.1 Wrap: USDC to wUSDC through Token Wrap, amount chosen by owner.
- AC-04.2 Deposit: public wUSDC into the confidential pending balance.
- AC-04.3 Apply: pending into available. The app applies before any send if pending is non zero. The worker flags accounts whose credit counter is at or above 80 percent of its maximum; the app prompts the owner to apply on the next unlock. Nothing happens without the owner.
- AC-04.4 After each step, balances update from chain state, not from local arithmetic.

### F-05 Balances and treasury
- AC-05.1 Overview shows: confidential available balance (owner only, decrypted locally), public wUSDC, public USDC, pending.
- AC-05.2 Balance history chart is computed in the browser from the owner's self disclosures plus public deposit and withdraw amounts (see `07-SELECTIVE-DISCLOSURE.md` section 6). No server side balance series exists in plaintext. Scheduled for Phase 2 (`12-MILESTONES.md`).
- AC-05.3 "What the chain shows" panel lists the org's recent onchain activity from public data only: addresses, times, instruction types, and "sealed" for confidential amounts.

### F-06 Single confidential payment
- AC-06.1 Owner picks a recipient whose confidential account is configured, enters amount and memo.
- AC-06.2 The recipient address is screened (D-10). A hit blocks the payment and logs the event.
- AC-06.3 Approval policy (D-04) is enforced before a plan is issued. The default policy is 1 approval, and the initiator's own execution counts as it, recorded with the execution signature; with a policy of 2 or more, the other approvers' signed approval messages are required before authorization (Q-11). In the hackathon build a policy above 1 cannot be set (Q-12): the settings page does not offer it and the API refuses it with `approval_policy_not_available`; the rule for 2 or more is tested through the API.
- AC-06.4 The client builds and executes the confidential transfer (v1 single transaction when available, else the multi transaction plan). On success, the client creates disclosures for every active grant whose scope covers the payment, plus a self disclosure for the owner and a recipient disclosure. Self and recipient disclosures are scheduled for Phase 1; the grant part of this criterion is scheduled for Phase 2 (`12-MILESTONES.md`).
- AC-06.5 If any transaction in the plan fails, the app shows exactly which step failed, closes any proof context accounts it created, and lets the owner retry safely. Tokens are never lost: a failed transfer leaves balances unchanged.

### F-07 Recipients
- AC-07.1 Owner adds a recipient: name, role, country, wallet address, default amount, team.
- AC-07.2 The app shows readiness per recipient: `no_account`, `not_configured`, `ready`.
- AC-07.3 An invite link lets the recipient sign in, register their viewing key, derive confidential keys and configure their wUSDC account. Readiness becomes `ready` from chain state. Accepting a recipient invite automatically creates an `own_payslips` grant for that recipient.
- AC-07.4 Recipients who are not `ready` cannot be paid confidentially; the UI says why.

### F-08 Payroll run
- AC-08.1 Owner uploads a CSV with header `wallet,amount,memo,name,team,country`. Amounts are decimal strings with at most 6 decimals. The app validates every row and shows errors per row. Rows match existing recipients by wallet; an unknown wallet is a row error with the message "Add this recipient first".
- AC-08.2 A run has statuses: `draft`, `awaiting_approval`, `approved`, `executing`, `settled`, `partially_settled`, `failed`.
- AC-08.3 **Post-hackathon (D-27, Q-12).** Approvers approve with a signed message (D-04) using the "Approve" action on `/app/[org]/payroll/[run]`, and see the contents hash they sign; the required count comes from org policy, and the initiator's execution counts as one approval (Q-11). In the hackathon build the run page shows only the initiator's approval (13 A31).
- AC-08.4 Execution follows D-21. Each line gets its own status and signature(s). Progress is shown live on the payroll gauge: it has as many ticks as lines, clamped to 12 minimum and 48 maximum; above 48, each tick represents ceil(lines/48) lines. Ticks fill as lines settle.
- AC-08.5 A partially settled run can be resumed; already settled lines are never paid twice (idempotency key per line stored before signing, and chain check before retry).
- AC-08.6 Disclosures for each line are created after that line settles.

### F-09 Withdraw and unwrap
- AC-09.1 Owner or recipient withdraws from confidential available to public wUSDC, then unwraps to USDC.

### F-10 Viewing grants
- AC-10.1 Owner grants a viewer a scope: `all_payments`, `period` (from, to), `payroll_only`, `own_payslips` (recipient), with optional expiry. The `totals_only` scope is Post-hackathon (D-27).
- AC-10.2 Grants are always created through an invite: the viewer accepts, becomes a user, registers a viewing public key (see `07-SELECTIVE-DISCLOSURE.md`), and the grant activates. Until then the grant is `pending_viewer_key`.
- AC-10.3 On grant creation, the owner's browser back fills disclosures for past payments inside the scope.
- AC-10.4 Revoke deletes stored disclosures for that grant and stops future ones. UI states that already viewed data cannot be unseen.
- AC-10.5 Every grant change is written to the access log.

### F-11 Accountant books
- AC-11.1 The accountant sees orgs where they hold an active grant, chooses one, and sees the scope banner (who granted it, scope, expiry).
- AC-11.2 The ledger decrypts disclosures in the browser. Filters: month, category (the disclosure payload `category`: `payroll`, `supplier`, `revenue`, `payouts`, `software`, `other`), needs receipt. Attaching receipts is out of MVP. Search runs on decrypted data in memory.
- AC-11.3 Reconciliation status per payment. Reconciliation notes (`reconciliation_notes`: one sealed box per reader, created and signed like disclosures) are Post-hackathon (D-27).
- AC-11.4 CSV export is generated in the browser. The server records an export event (who, when, scope, row count) visible to the owner in the access log.
- AC-11.5 (Post-hackathon, D-27) Month close checklist items persist per org and month.

### F-12 Recipient: My pay
- AC-12.1 Shows the recipient's payslips from recipient disclosures (gross, tax withheld, net if provided by the payroll CSV extension columns `gross,tax`; otherwise net only).
- AC-12.2 "What your colleagues see" shows the public view of their incoming payments.
- AC-12.3 Payslip PDF is generated in the browser.

### F-13 Proof of funds
- AC-13.1 Owner chooses threshold and counterparty label. The browser generates the equality and range proofs, verifies them into context state accounts, and calls `sotto_proofs::verify_balance_threshold`. On success a `ProofRecord` exists onchain.
- AC-13.2 If the balance is below the threshold, proof generation fails locally; the UI shows **Not proven** and creates nothing onchain.
- AC-13.3 A public verification page `/v/<proof_record_address>` reads the record from chain and shows: org `legal_name` (from the SAS attestation, found through `ProofRecord.owner`), statement ("Balance is at least $X"), slot and time, expiry, "Balance disclosed: none". No login required.
- AC-13.4 Proof context accounts are closed and rent returned after the record is written.

### F-14 Access log
- AC-14.1 Records: grant created, revoked, expired; disclosure batch created; export; proof issued; approval; payroll executed. Metadata only, never amounts.

### F-15 Privacy screen
- AC-15.1 Toggle blurs every amount in the UI; hovering one amount reveals it. Preference stored per device.

### F-16 Command palette (Post-hackathon, D-27)
- AC-16.1 Cmd or Ctrl plus K opens it; commands are role aware and only include implemented actions.

### F-17 Marketing site
- AC-17.1 The landing page matches `design/sotto-landing.html` with the copy corrections applied.
- AC-17.2 The "Request access" form has "Work email" and "Company" fields and stores both in the waitlist table with double opt in. Confirmation emails are sent through Resend (DEFAULT).

### F-18 Privacy score (Post-hackathon, D-27)
Computed per org per quarter, 0 to 100, compared with the previous quarter, shown with its breakdown:
- 40 points times the share of outgoing payments in the quarter that were confidential transfers, counted by number of payments (the server does not know values).
- 25 points if every active grant has an expiry at most 400 days away.
- 20 points if no grant has been unused for more than 90 days.
- 15 points if the org's verification attestation is active.

If the quarter has zero outgoing payments, the 40 point term is omitted and the remaining 60 points are rescaled to 100. `grants.last_used_at` updates when the viewer successfully fetches disclosures.

### F-19 Proof program availability
- AC-19.1 The worker checks that the ZK ElGamal Proof program is active on the cluster every 5 minutes (simulate a proof verification transaction). If it is not active, a banner appears and every confidential action is disabled. Public balances and public transfers keep working. Confidential balances cannot be withdrawn until the program is active again, because withdraw needs proofs; the banner says so plainly.
