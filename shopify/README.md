# Shopify page overrides

Front-end code for pages that live in Shopify, not in this app. Kept here so the
changes are reviewable and versioned instead of existing only in a Shopify admin
textarea.

Nothing in this folder is built, bundled, or served by the Driver App. Deploying
the Driver App does not deploy any of it.

---

## `basket-builder-mobile.css`

Mobile redesign of the **size step** on the Rosh Hashanah Basket Builder:
<https://thesweettooth.com/pages/rosh-hashanah-basket-builder>

Phones only — everything is inside `@media (max-width: 749px)`, so the desktop
layout is byte-for-byte unchanged.

Layout is a **two-column grid, photo on top** — the standard premium-retail
grid on mobile (Aesop, Bottega, Sugarfina), and what Baymard reports as the
default column count for phones. Two alternates are in `alternates/`.

### The bug it fixes

The existing mobile CSS intends a side-by-side card: photo left, text right.
The widths cannot fit:

```css
.basket-card .basket-image   { flex: 0 0 47%; }
.basket-card .basket-content { flex: 1 1 53%; }
.basket-card                 { gap: 10px; }
```

47% + 53% + a 10px gap is wider than 100%. A separate rule at `max-width: 600px`
then adds `.basket-card { flex-wrap: wrap; }`, so on every real phone the two
halves wrap onto **separate rows** — a small photo stranded in a half-empty row,
the text below it, and a full-width 46px bar under that.

Measured on a 390×844 viewport (iPhone 14/15):

| | before | after |
|---|---:|---:|
| Basket photo, as drawn | 78 × 52px | **134 × 89px** |
| Full size list | 2,361px | **742px** |
| Scroll before the first basket is visible | 1,164px | **839px** |

## Proportions

The product shots are **3:2 landscape** (1200×800). Every photo column here is
3:2 to match, so the basket fills it edge to edge.

This is the mistake worth not repeating: an earlier pass put those 3:2 photos
into a **square** column. `object-fit: contain` fits by width, so a third of the
box was empty air and the basket collapsed to 78×52px — smaller than the
"See it wrapped" button sitting next to it. On this page the basket is always
the largest element on the card, and every control is ranked below it.

### What else changed

- **Selection** is a ring instead of `translateY(-6px)`, so choosing a size no
  longer shifts the page under your thumb. The checkmark moved to the card's
  top-left; at top-right it was sitting on top of the price.
- **"See it wrapped"** went from a full-width 46px cream bar to a plain grey
  text link with no box. It is Rosh Hashanah only for now — the year-round
  baskets get it later — so it must not shape the card. It keeps a ~44px touch
  area via an invisible `::after`, so a near-miss still cannot select the
  basket.
- **Artwork carries a slight nod to real basket diameter** (10″ → 30″), held
  under 10% so the small sizes still read as product photos, not thumbnails.
- **The size ladder strip is kept**, just tightened.
- Jumbo/Penultimate/Supreme ship with a #FCFCFC–#FEFEFE backdrop that reads as a
  grey box on a white card. `filter: brightness(1.03)` clips it to white;
  mid-tones move about 2/255.
- The `serving-pill` is no longer solid black on all eight rows.
- Prices use `tabular-nums` so they align down the list.
- An **optional** second block compacts the hero. It is separated by a comment
  and can be deleted on its own if only the card fix is wanted. It changes no
  copy — image crop, type sizes and spacing only.

Palette follows the brand rules: `#1D1D1F` ink (never `#000`), `#E8E8E8`
hairlines, `#FAFAFA` off-white, `#D4AF37` gold as a sparing accent.

### How to apply

Not automated — no Shopify credentials are wired into this repo, and
customer-facing changes need sign-off before they go live.

1. Shopify admin → the source that holds the builder markup for
   `/pages/rosh-hashanah-basket-builder` (the page's own HTML, or its custom
   page template if it has one).
2. Paste the file's contents at the **end**, wrapped in a `<style>` tag. It must
   come after the existing `@media (max-width: 749px)` block so it wins the
   cascade.
3. Check on a real phone before publishing.

To roll back, delete the `<style>` block. Nothing else is touched.

### Alternates

Same bug fix, different layout. Each is self-contained — use one *instead of*
the card block in `basket-builder-mobile.css`.

| | Photo as drawn | Full list | Reference |
|---|---:|---:|---|
| **Two-up grid** (shipped) | 134 × 89px | 742px | Aesop, Bottega, Sugarfina |
| `option-a-list-row.css` | 131 × 87px | 1,057px | Apple Store product rows |
| `option-c-editorial.css` | 279 × 186px | 2,366px | Bottega, Le Labo |

C has by far the biggest photo and by far the longest scroll — it lands close to
the page's original height, which is the problem this started from.

### Not covered

- `/pages/build-a-basket` (the year-round builder) has the same underlying flex
  bug but a different surrounding page. This file is not drop-in for it.
- The horizontal overflow at ≤360px comes from the theme's off-canvas menu
  drawer. It is identical before and after this change and is untouched here.
