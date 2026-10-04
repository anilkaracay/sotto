# Third party logos

Logos of other organizations that Sotto's pages show, where each file came from, and the terms it is used under. Step 4.4 (founder, 2026-10-04): the landing's "Built with" row. The marks are drawn unmodified; the code that draws them is `apps/web/app/_landing/brand-logos.tsx`, and the files its paths come from are in `third-party/`.

The landing's footer carries the attribution line "All trademarks are property of their respective owners." Neither mark implies that Solana or Circle endorses Sotto.

## Solana

| | |
|---|---|
| File | `third-party/solana-simple-icons-16.34.0.svg` |
| Source | the npm package `simple-icons` 16.34.0, `icons/solana.svg` (tarball `https://registry.npmjs.org/simple-icons/-/simple-icons-16.34.0.tgz`) |
| sha256 (tarball) | `25887ddf96a084a82f9181dc3a7e99750d6b5ac4339fe9321d0e2bf14669dc65` |
| sha256 (svg) | `35472f0ee6e700a48c5c19c975dfe89242d987c415ec969ed5b0b6a3a487c301` |
| License | the package is released under CC0-1.0 (`LICENSE.md`); its data file lists no separate license for this icon |
| Trademark | Solana is a trademark of its owner. The package's `DISCLAIMER.md` asks users to follow the brand's guidelines |
| Brand data | `data/simple-icons.json`: hex `9945FF`, source and guidelines `https://solana.com/branding` |
| Use | 16 pixels, filled with the brand color `#9945FF`, beside the word "Solana" |

## USDC

| | |
|---|---|
| File | `third-party/usdc-lockup.svg` ("USDC Lockup.svg" from the archive, black) |
| Source | Circle's brand kit, linked from `https://www.circle.com/pressroom`: `https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/Pressroom/brandkit/logo-downloads/usdc.zip` (folders Lockup, Token Logo, Symbol) |
| sha256 (zip) | `538ce962b272760340db1ff53e8a26ce28f22a573fcd4bc9681f0fd44e1dfa82` |
| sha256 (svg) | `f93d752072fe6495a443af492331d99ad78b450032c67fc0fde4be2678c46c7d` |
| Terms | Circle's Brand Use Policy, `https://www.circle.com/hubfs/CircleBrandUsePolicy.pdf` (sha256 `7df0a4b685d307c04f4468c88546fe2d36bc74ee33b6e87aba691187b06f74e1`), downloaded 2026-10-04 |
| Use | the lockup at 24 pixels tall (83 wide), the policy's minimum for the USDC lockup on screens, in its own chip without a separate word |

What the policy asks, and how the page follows it:

1. No modification of the logo: the paths and the black fill are the file's own.
2. Minimum size on screens: 24 pixels tall for the USDC lockup, 32 for the token logo. The chip uses the lockup at 24 pixels; the token logo is not used, because at 32 pixels it would not fit the 42 pixel chip beside the 16 pixel icons of the others.
3. Clear space equal to the width of the opening in the symbol (about 6 pixels at this size): the chip leaves 9 pixels above and below and 18 at each side.
4. No implied partnership or endorsement: the row says "Built with", which states that Sotto uses USDC.
5. Attribution where feasible: the footer's trademark line.
