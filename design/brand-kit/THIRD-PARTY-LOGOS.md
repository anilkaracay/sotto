# Third party logos

Logos of other organizations that Sotto's pages show, where each file came from, and the terms it is used under. Step 4.4: the landing's "Built with" row. The code that draws them is `apps/web/app/_landing/brand-logos.tsx`; the files its paths come from are in `third-party/`.

The landing's footer carries the attribution line "All trademarks are property of their respective owners." Neither logo implies that Solana or Circle endorses Sotto.

The founder chose these two files on 2026-10-04 ("the originals", from the founder's Downloads folder) in place of the first choice of the step (the simple-icons Solana mark and Circle's USDC lockup from its brand kit zip). Where the founder obtained them is not recorded here.

## Solana

| | |
|---|---|
| File | `third-party/solana-sol-logo-horizontal.svg` (Adobe Illustrator export, 2568 x 643) |
| sha256 | `07e01efae04a13f11c89bf046efc1195aa67f2aaa8d016162606c89fc27f3538` |
| Content | The horizontal lockup, the mark and the word SOLANA, black, on a white background rectangle |
| Trademark | Solana is a trademark of its owner; brand guidelines at https://solana.com/branding |
| Use | 20 pixels tall (107 wide) in its own chip without a separate word. The nine paths and their fill rules are the file's own; the white background rectangle is not drawn (the chip is white), and the view box is cropped to the artwork (`189 116 2190 411`) |

## USDC

| | |
|---|---|
| File | `third-party/usd-coin-usdc-logo.svg` (2000 x 2000) |
| sha256 | `9b65dad45a860a741be69ad77660e38669a7b3b06ac018a40b6b5c4c975c2951` |
| Content | The round USDC token logo, blue `#2775ca` with white marks |
| Terms | Circle's Brand Use Policy, `https://www.circle.com/hubfs/CircleBrandUsePolicy.pdf` (sha256 `7df0a4b685d307c04f4468c88546fe2d36bc74ee33b6e87aba691187b06f74e1`, downloaded 2026-10-04) |
| Use | 32 pixels, beside the word "USDC" |

What Circle's policy asks, and how the page follows it:

1. No modification of the logo: the paths and fills are the file's own.
2. Minimum size on screens: 32 pixels for the token logo. The chip draws it at 32 pixels.
3. Clear space as wide as the opening in the symbol (about 6 pixels at 32 pixels): the word sits 9 pixels away; the chip's own white ground reaches 5 pixels past the logo's left edge.
4. No implied partnership or endorsement: the row says "Built with", which states that Sotto uses USDC.
5. Attribution where feasible: the footer's trademark line.
