# 09 · Frontend

## 1. Routes

| Route | Screen | Auth |
|-------|--------|------|
| `/` | Landing (from `design/sotto-landing.html`) | Public |
| `/v/[address]` | Public proof verification | Public |
| `/trust` | Trust page (D-01, `13-COPY-CORRECTIONS.md` L6 and L7, `10-SECURITY.md` section 4) | Public |
| `/app` | Redirects to the first page of the user's role in their last used org | Session |
| `/app/onboarding` | Create org, KYB form, status | Session |
| `/app/[org]/overview` | Owner overview; withdraw (F-09) opens as a drawer here | Owner |
| `/app/[org]/setup` | Confidential account setup and funding (F-03, F-04) | Owner |
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
| `/app/admin` | KYB review | Sotto admin |

The role switcher in the design becomes an **org and role switcher**: it lists the memberships of the signed in user. It never impersonates another person.

## 2. Design fidelity

- Tokens: extract every CSS variable, font size, radius, shadow and animation into two scoped themes: `packages/ui/theme-landing.css` scoped to `.theme-landing` (from `design/sotto-landing.html`) and `packages/ui/theme-app.css` scoped to `.theme-app` (from `design/sotto-app.html`). Fonts: Geist and Geist Mono through `next/font`.
- Components to build: top pill nav, page header (overline plus title), dark hero card, white card, glowing bar chart, radial tick gauge (with fill by progress), hatched benchmark bar, barcode strip, sky card with glass card, table, chips, pill buttons, drawer, toast, privacy screen, role switcher menu. The command palette is Post-hackathon (D-27).
- Motion: keep entrance animations; respect `prefers-reduced-motion`.
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
