# Sotto

Private books. Public chain.

Sotto is the confidential business account for companies that pay in stablecoins on Solana. Addresses stay public; amounts are sealed, and only the people a company chooses can read them. This system is the brand: the mark, the colors, the type, the voice, and the files to use them.

## The idea: the horizon

*Sotto* is Italian for *under*. In music, *sotto voce* means "in a low voice": said quietly, heard only by the people meant to hear it.

The mark is a horizon. Above the line, a circle drawn in outline: what anyone can see on the chain. Below the line, the same circle filled: what is sealed. One line separates public from private, and that line is the product.



## Logo

### Versions

| Version | Use it for | File |
|---|---|---|
| Horizontal lockup | The default everywhere there is room: site header, documents, decks, partner pages | `sotto-lockup-ink.svg`, `sotto-lockup-white.svg` |
| Stacked lockup | Square or centred layouts: cover slides, event screens, merchandise | `sotto-lockup-stacked-ink.svg`, `sotto-lockup-stacked-white.svg` |
| Wordmark | When the mark already appears nearby, or space is very wide and short | `sotto-wordmark-ink.svg`, `sotto-wordmark-white.svg` |
| Mark | Social avatars, small spaces, a sign off at the end of a video | `sotto-mark-ink.svg`, `sotto-mark-white.svg`, `sotto-mark-blue.svg` |
| App icon | Home screens, browser tabs, app stores. The horizon runs to the edge of the frame | `sotto-app-icon-ink.svg` and the Icons group |



### Construction

Everything is measured from the wordmark, set in Geist Medium.

- **The circle is twice the x height**, and its centre sits exactly on the x height. So the horizon line of the mark lines up with the top of the lowercase letters, and the filled half occupies the same band as the word.
- **Stroke weight equals the stem of Geist Medium** (108 units at a 1000 unit em). The horizontal line is drawn slightly lighter (96 units), as type does, so both read as the same weight.
- **The line overhangs the circle by 17% of its diameter** on each side.
- **The filled half is drawn 0.7% smaller** than the outlined half. Solid shapes look larger than outlines; this keeps the two halves visually equal.
- **The gap between mark and wordmark is half the x height.**
- The wordmark is Geist Medium, tracked to -18 units, using Geist's own *tt* ligature. It is outlined in the files. Never retype it.

### Clear space and minimum size

- **Clear space:** keep a margin equal to the x height of the wordmark (half the circle's diameter) on every side. Nothing enters it: text, edges of the page, other logos.
- **Minimum size:** horizontal lockup 96px wide on screen, 24mm in print. Stacked lockup 64px wide. Below 24px use the app icon or the favicon, never the bare mark with its thin outline.

### Color

The logo is always one solid color.

- `ink` on `surface` or `canvas`: the default.
- White on `night` or on photography that is dark and calm at the logo's position.
- White on `signal` for a few brand moments (a sticker, a launch post). Never `signal` on `night`.
- The blue mark on white is allowed for the mark alone, never for the lockup.

### Do not

- Recolor the two halves differently, or fill the top half.
- Change the length of the horizon line, or let it touch anything.
- Rotate, skew, outline, add shadows, glows or gradients.
- Retype the wordmark or change its spacing.
- Put the logo on busy imagery. Use a `night` plate instead.
- Combine the mark with another logo in one shape. Partner lockups sit side by side, separated by a hairline and the clear space.

## Color

Sotto is a quiet brand: a calm ground, a deep ink and one signal blue. Roughly:

- **70%** `canvas` and `surface`
- **20%** `ink` and `night`
- **10%** `signal`

`sealed`, `caution` and `danger` are states, not decoration. `sealed` appears only when something is done and true: Proven, Settled, Verified. Never use red and green as the only difference between two states; pair color with a word or an icon.

Text contrast: `ink` and `ink-2` for reading; `muted` is the lightest text allowed and passes AA on both grounds in both themes.

## Typography

- **Geist** for everything people read. Weights 400 and 500 only. Headings use 500 with tight negative tracking; body uses 400.
- **Geist Mono** for addresses, signatures, code and anything someone might copy.
- **Figures:** amounts always use tabular numbers (`font-variant-numeric: tabular-nums`) so columns line up, and they keep their currency: `1,250.00 USDC`, never a bare number.
- **Case:** sentence case everywhere, including buttons and headings. No all caps except tiny labels, and even there prefer sentence case.

Geist and Geist Mono are free (SIL Open Font License). In the product they come from the `geist` package on npm; on the web they are also on Google Fonts.

## The horizon line

The brand's one graphic device. A single straight rule at the height of the mark's horizon, running edge to edge:

- At the logo's own line weight, never thinner or thicker.
- In white at 16% on `night`, or in `line` on light grounds.
- Once per composition. It is a horizon, not a pattern.
- The mark sits on it, or the content sits below it. Never above it as decoration.

It appears on the social images, on section breaks of the landing, and as the opening frame of videos: the line draws from left to right, then the circle appears.

## Voice

Sotto speaks like a careful finance colleague: calm, exact, and honest about what is true today.

- **Plain words.** "Your accountant can read the amounts in September" beats "granular selective disclosure".
- **True claims only.** Say what is built and measured. During the beta, say that it runs on Solana devnet. Never imply mainnet before it is live.
- **The product's own words:** *sealed* (not hidden), *read only key* or *viewing key*, *Proven* and *Not proven* (never True or False), *settled*.
- **Avoid:** anonymous, untraceable, invisible, mixer, stealth. Sotto is confidential, not anonymous: who paid whom stays public.
- **Punctuation:** no em dashes or en dashes anywhere, in any material. Use a colon, a comma, a middle dot or a new sentence.
- **Numbers:** measured, sourced, or not used.

| Write | Not |
|---|---|
| Amounts are sealed on Solana. Only the people you choose can read them. | Your transactions are 100% invisible. |
| A payroll run of 24 people takes 3 wallet approvals in Solflare. | Lightning fast payroll at scale! |
| Revoking stops access from then on. It cannot erase what was already viewed. | Revoke access anytime and your data is gone. |

## Imagery

- **Sky and light:** the landing uses soft, photographic sky, with clouds drifting slowly. Calm, open, daylight.
- **Product truth:** screenshots show real flows. Sample figures are labelled as sample data.
- **Avoid:** 3D coins, neon, padlocks, hooded figures, matrix code, anything that suggests secrecy for its own sake.

## Iconography

Line icons on a 24px grid with a 1.5px stroke, round caps and joins, in `ink` or `muted`. Filled icons only for states. The app icon and favicon are in the Icons group; never redraw the mark as an icon.

## Files

- **Logos:** every version as outlined SVG, in ink, white and (mark only) blue.
- **Icons:** the app icon in three grounds, the favicon, and the 180px touch icon.
- **Social:** the link preview image (1200 x 630), the X banner (1500 x 500) and the avatar (400 x 400).

Source of truth: these values were set in October 2026 to match the Sotto app and landing. Where the code in the Sotto repository differs, the code wins and this system is updated to match.
