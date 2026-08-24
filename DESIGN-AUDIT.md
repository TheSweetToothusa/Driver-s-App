# HIG Design Audit — Driver App

Audit of `App.tsx` (7,512 lines) and `index.css` against Apple's Human Interface
Guidelines. Every number below came from counting the actual source, not from a
style opinion. Nothing in this audit has been applied to the UI — `index.css`
gained a token layer that defines new utilities only, so no rendered pixel moved.

**Nothing here should be applied without Mikey's sign-off** (CLAUDE.md: "Do not
make UX changes without confirming with Mikey first").

---

## First: two claims to throw out

Anyone bringing an "Apple design" checklist to this repo will likely repeat these.
Both are wrong.

**"53° typography rules."** There is no angle-based typography rule anywhere in
the HIG. Headings are not set at 53° or any other angle. The rule that does exist
is a *point-size* scale — 11pt floor, 17pt body — which is what this audit uses.

**"Add glassmorphism and gradient backgrounds."** `.glass-morphism` has been
defined in `index.css` since before this audit and is used **0 times** in
`App.tsx`. It is dead CSS. More importantly, this is a delivery app read
one-handed in a van in Miami sun. Translucent surfaces lower contrast, which is
the opposite of what the app's own hard rules demand (names "extremely large,
bold, black"). Do not adopt it. Either delete the rule or leave it dormant.

---

## Finding 1 — 140 instances of text below Apple's 11px floor

This is the only finding that is a genuine accessibility failure rather than an
inconsistency.

| Size            | Count | HIG status                    |
|-----------------|------:|-------------------------------|
| `text-[8px]`    |     5 | Far below the 11pt floor      |
| `text-[9px]`    |    48 | Far below the 11pt floor      |
| `text-[10px]`   |    87 | Below the 11pt floor          |
| `text-[11px]`   |    17 | At the floor — acceptable     |
| `text-[13px]`   |     1 | Fine, but off-scale           |

**56 of those sub-11px instances also carry `text-stone-300` or `text-stone-400`.**
That compounding is the real problem:

- `text-stone-400` (#a8a29e) on white = **2.5:1** — WCAG AA requires 4.5:1
- `text-stone-300` (#d6d3d1) on white = **1.6:1**

So 56 places render ~9px text at under a third of the required contrast. These are
status badges and eyebrow labels — `App.tsx:233`, `350`, `569`, `611`, `627`,
`2162`, `2175`, `2190` and similar. A driver squinting at a phone in sunlight
cannot read them.

**Fix:** raise to `text-caption2` (11px) and swap `text-stone-400` → `text-ink-muted`
(#78716c, 4.7:1) or `text-ink-secondary` (#57534e, 7.0:1). Uppercase + `tracking-widest`
+ `font-black` already compensate somewhat for the small size; the contrast swap is
the part that matters most and is the cheapest to ship.

## Finding 2 — no type scale; 579 size declarations across 14 sizes

`text-sm` (216 uses) is doing the work of body text at 14px. HIG body is 17px.
158 of the 579 declarations are arbitrary bracket values rather than scale steps,
which is why sizes drifted to 8px, 9px, 10px, 11px and 13px with no rule
distinguishing them.

**Fix:** the new `@theme` block in `index.css` defines the HIG scale as named
utilities (`text-caption2` … `text-largetitle`, plus `text-name` / `text-name-lg`
for the oversized recipient and gift-sender names the hard rules require). Adopt
per-component. A global find-and-replace would be a 579-site diff and is not
worth the regression risk.

## Finding 3 — spacing is grid-aligned; 109 half-steps are the exception

Good news first: **zero** arbitrary pixel spacing values (`p-[13px]` and friends)
exist in `App.tsx`. Everything uses Tailwind's numeric scale, which is 4px-based
and therefore already 4pt-grid aligned.

The exceptions are the half-steps, which land between grid lines:

| Class    | Renders | Count |
|----------|--------:|------:|
| `*-0.5`  |     2px |    19 |
| `*-1.5`  |     6px |    57 |
| `*-2.5`  |    10px |    27 |
| `*-3.5`  |    14px |     6 |

109 total. This is cosmetic drift, not a defect — worth fixing opportunistically
when touching a component, not in a sweep. The named `step-1` … `step-7` spacing
tokens exist so *new* code has an obvious correct choice.

## Finding 4 — touch targets unverified

HIG requires 44×44pt minimum for anything tappable. Several controls use
`px-1.5 py-0.5` (6px/2px padding), which cannot reach 44px on its own. A
`.tap-target` utility now exists to enforce the minimum without changing a
control's visual size. Which controls actually need it requires rendering the app
and measuring — see below.

---

## What this audit did *not* do

Two of the four steps in the workflow this came from were not run, and it's worth
being explicit rather than implying full coverage:

- **Playwright responsive/accessibility testing.** Chromium is available in this
  environment, but the app needs a live database connection to render past login,
  so measured touch-target sizes and a real axe-core contrast pass are not in
  here. The contrast figures above are computed from the hex values in source,
  which is reliable for text-on-white but does not cover text over images or
  colored badge backgrounds (`cfg.bg` / `cfg.text` at `App.tsx:233`).
- **Figma MCP sync.** No Figma file is connected to this repo, so there was
  nothing to diff the implementation against.

## Suggested order, if approved

1. **Contrast swap on the 56 tiny-and-faint instances** — highest real-world
   impact for drivers, smallest diff, no layout shift.
2. **Raise sub-11px text to `text-caption2`** — small layout risk in badges;
   check the order-card header doesn't wrap.
3. Adopt named type tokens as components get touched for other reasons.
4. Half-step spacing cleanup — lowest priority, purely cosmetic.

Steps 1 and 2 together are roughly a 140-line diff and would need a visual pass
on the order list and order detail screens before pushing anywhere near `main`.
