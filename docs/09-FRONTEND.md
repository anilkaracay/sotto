# 09 · Frontend

## 1. Routes

| Route | Screen | Auth |
|-------|--------|------|
| `/` | Landing (from `design/sotto-landing.html`) | Public |
| `/v/[address]` | Public proof verification | Public |
| `/trust` | Trust page (D-01, `13-COPY-CORRECTIONS.md` L6 and L7, `10-SECURITY.md` section 4) | Public |
| `/app` | Redirects to the first page of the user's role in their last used org. Without a session it sends the visitor to `/app/sign-in`. Since step 1.4 a user without an organization, or who owns one, goes to `/app/onboarding` until the owner screens exist; since step 1.5 the owner of an active org goes to `/app/[org]/setup` until the overview exists (step 1.10); members with other roles see the signed in shell until their pages exist | Session |
| `/app/sign-in` | Sign in (F-01): the wallets that meet D-26, connect, then sign in (`solana:signIn` or a signed message, D-15). A signed in visitor goes to `/app` | Public |
| `/app/onboarding` | Create org, KYB form, status (step 1.4): without an owned org, the form (legal name, optional display name, country, registration number, website, contact email) validated with the API's schema, and a note that the attestation onchain carries the org ID, legal name, country, verification date and review level for anyone to read; with one, the status card ("In review", "Verified" with the attestation address or "being issued", "Not verified", 13 A35) and the business details; "Change details" while in review | Session |
| `/app/[org]/overview` | Owner overview; withdraw (F-09) opens as a drawer here | Owner |
| `/app/[org]/setup` | Confidential account setup and funding (F-03, F-04). Step 1.5 builds its keys part: the wallet card (the signed in wallet, connected again after a reload), the confidential keys card (Locked with the unlock explainer of 13 A36 and "Unlock with your wallet", then Unlocked with the encryption public key and Lock) and the viewing key card (Registered, or Create viewing key). Only for the owner of an active org; an org in review or suspended goes to `/app/onboarding` | Owner |
| `/app/recovery` | Recovery guide (10 section 2, mitigation 3): moving a confidential balance back to public with the standard Solana command line tools; linked from the wallet refusal message (step 1.5) | Public |
| `/app/[org]/recipients` | Recipients (F-07) | Owner |
| `/app/[org]/settings` | Approval policy (1 approval, not changeable in the hackathon build, Q-12, 13 A32), budgets | Owner |
| `/app/[org]/board` | Board view: read only totals (Post-hackathon, D-27) | Board viewer |
| `/app/[org]/payroll` and `/app/[org]/payroll/[run]` | Payroll; the run page's approvals block shows the initiator's approval only (Q-12, 13 A31); the approvers' "Approve" action is Post-hackathon | Owner |
| `/app/[org]/payments/new` | Single payment | Owner |
| `/app/[org]/keys` | Viewing keys (grants) | Owner |
| `/app/[org]/proofs` | Proofs of funds | Owner |
| `/app/[org]/books` | Accountant books | Accountant |
| `/app/[org]/close` | Close and export (Post-hackathon, D-27; the CSV export is in Books) | Accountant |
| `/app/[org]/pay` | My pay | Recipient |
| `/app/invite/[token]` | Accept invite, register viewing key, configure account | Session |
| `/app/admin` | KYB review (step 1.4): status filters (In review, the default, Active, Suspended, All), the org table with owner wallet and attestation state ("Issuing…", the address, "Closing…"), and Approve, Reject or Suspend, each confirmed with a second click. Everyone outside the `admins` table gets the 404 page; admins reach it from the switcher ("Business review") | Sotto admin |

The role switcher in the design becomes an **org and role switcher**: it lists the memberships of the signed in user. It never impersonates another person. Since step 1.4 an owned org links to `/app/onboarding`, an org not yet verified carries its status chip, and Sotto admins see a "Business review" entry.

## 2. Design fidelity

- Tokens: extract every CSS variable, font size, radius, shadow and animation into two scoped themes: `packages/ui/theme-landing.css` scoped to `.theme-landing` (from `design/sotto-landing.html`) and `packages/ui/theme-app.css` scoped to `.theme-app` (from `design/sotto-app.html`). Fonts: Geist and Geist Mono through `next/font`.
- Components to build: top pill nav, page header (overline plus title), dark hero card, white card, glowing bar chart, radial tick gauge (with fill by progress), hatched benchmark bar, barcode strip, sky card with glass card, table, chips, pill buttons, drawer, toast, privacy screen, role switcher menu. The command palette is Post-hackathon (D-27).
- Motion: keep entrance animations; respect `prefers-reduced-motion`.
- Built in step 1.3: the app tokens in `packages/ui/theme-app.css`; `Button`, `Chip`, `Card` (white and dark), `PageHeader`, `TopNav`, `Table` with `Th` and `Td`, `Drawer` and `Toast` in `packages/ui` (CSS Modules with the design's values); the shell in `apps/web` (header, network label per 13 A25, org and role switcher per A9 with sign out). The top nav shows only screens that exist, and the header shows no privacy toggle, command search or notifications until they are built (13 A29, A33). Pixel polish comes with the visual baselines (plan move M2).
- Built in step 1.4: the onboarding and admin screens from the same components; the form fields (label, control, hint, error) are styled locally in `app/app/onboarding` on the app tokens because the design has no form fields; they move to `packages/ui` with the second form (F-07) or the design pass (13 A35). Dates show as "27 Sep 2026" in UTC with fixed month names (`lib/format.ts`), identical on the server and in the browser.
- Visual regression: Playwright screenshots of each screen. Baselines come from our own build after founder visual sign off, not from the design HTML. The app is desktop first, minimum width 1280 in MVP, baselines at 1440 only. Landing baselines at 1440 and 390 (tolerance documented in `11-TESTING.md`).

## 3. Screen data mapping

Every element either maps to real data below or is removed per `13-COPY-CORRECTIONS.md`.

### Owner overview
| Element | Source |
|---------|--------|
| Welcome name | User display name from profile |
| Date range chip | Local state; filters charts |
| Balance growth bars | Browser computed from balance snapshots and public flows (07 section 6). Locked state if keys not unlocked. |
| Payroll against budget | Budget stored in the owner private blob; actual from the owner's self disclosures of the current run |
| Settlement percentage and strip | Server: percentage computed from `payment_attempts` as (payments settled on attempt 1) / (payments settled) for the selected period; shown only when the period has at least 20 settled payments, otherwise the card shows the empty state "Not enough payments yet"; strip = per day counts |
| Confidential account card | Token account address (public), "Sealed" |
| Recent activity table | `chain_activity` joined with owner self disclosures for amounts (decrypted in browser); "Can read amount" avatars from active grants covering each payment |

### Payroll
Run total by team: decrypted from the run private blob in the browser. Settlement gauge: as many ticks as lines, clamped to 12 minimum and 48 maximum; above 48, each tick represents ceil(lines/48) lines; fill from payment statuses. Approvals: from `approvals`; in the hackathon build only the initiator's approval, recorded with the execution signature (Q-12, 13 A31). The approvers' Approve action with the contents hash is Post-hackathon (AC-08.3). Recipients table: recipients plus line status. "Last 12 runs": counts and settled state only (amount bars are relative heights computed in the browser from self disclosures).

### Viewing keys
Coverage bars: share of disclosure items per viewer out of all owner self items in the last 12 months (counts, computed in browser from metadata). Keys table: `grants`. Access log: `access_log`.

### Board (Post-hackathon, D-27)
Read only, in the app design language, reusing overview cards: totals and month totals, treasury balance snapshot, balance growth, privacy score, recent activity without amounts.

### Proofs
Builder: thresholds `$100k, $500k, $1M, $2.5M` plus custom; counterparty label free text. Statement wording: "Balance is at least $X". Certificate: from the onchain record just written. Issued list: `proof_records`.

### Books (accountant)
Money in and out totals: sums of decrypted disclosures in the browser. Reconciliation: `reconciliations`. Ledger: disclosures in scope, decrypted, joined with `chain_activity` for signatures and times.

### Close and export (Post-hackathon, D-27)
Checklist: `close_items`. In the hackathon build the CSV export is generated client side inside Books (AC-11.4); the server logs the event only.

### My pay
Payslip card, 6 month chart and list: recipient disclosures. "What your colleagues see": `chain_activity` for the recipient address.

## 4. Required states for every screen

- **Locked**: confidential data needs keys. Show a clear "Unlock with your wallet" action. Never show zero.
- **Loading**: skeletons matching the layout.
- **Empty**: purposeful copy and the next action.
- **Error**: specific message and retry. Chain errors are decoded to plain language.
- **Proof program unavailable** (F-19): banner, confidential actions disabled.

## 5. Proof generation UX

- Runs in a Web Worker. Show step progress: preparing, proving, verifying, recording, cleaning up.
- Measure time per step (Gate G3). If proving exceeds 3 seconds per transfer on a mid range laptop, show an estimated time for payroll runs before signing.

## 6. Landing integration

- "Request access" opens the waitlist form (F-17).
- "Sign in" goes to `/app`.
- "See who sees what" scrolls to the views section.
- SDK section links go to the GitHub repository and docs URL from config; if not public yet, the section says "Coming soon" instead of dead links.

## 7. Accessibility and quality bars

- Keyboard navigation for every control, visible focus, ARIA labels on icon buttons, semantic tables.
- Color contrast AA for text.
- Lighthouse: performance 90 or more on landing (desktop), accessibility 95 or more on all pages.
- No console errors or React warnings in production builds.
