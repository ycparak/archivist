# Archivist design direction

This document is the visual and interaction contract for Archivist. Read it with
the [product requirements](./prd.md), [technical architecture](./architecture.md),
and [`AGENTS.md`](../AGENTS.md) before adding or changing UI.

## Product stance

Archivist is a working surface for remembering and exploring one person’s Are.na
archive. The primary reader is trying to find a visual reference, idea, phrase,
material, or atmosphere and then inspect the original block in context. The
interface should feel like a quiet research desk: useful immediately, dense with
real archive material, and free of marketing ceremony.

The page should answer the reader’s next question in order:

1. Can I search or browse the archive immediately?
2. What did the archive return?
3. What is the original block and where can I inspect it further?

Do not add copy, panels, metadata, or interactions that do not support that job.

## Visual thesis

A light-only, desktop-application surface. A recessed sidebar sits beside a flat gray
pane; a thin dark rule opens each region; one type size does all the work; square
controls carry a 1px border and nothing else. The archive's images are the only
things with visual weight. Typography, alignment, and whitespace create presence, and
hierarchy comes from color (black, then grays) and position rather than size or weight.

This is the same design system as the maintainer's personal site
(`yusufparak`, `architecture` branch): the ABC Areal typeface, a 13px/15px interface
size, an oklch gray ramp, blue for links and selection, and cap-height text trimming.
Archivist reuses it, replaces that site's ad-hoc semantic aliases with the role-based
tokens below, and drops what a search tool does not need (article-only styling, custom
grid lines, motion).

## Layout

The page is a two-column shell owned by
[`src/routes/+layout.svelte`](../src/routes/+layout.svelte):

- **Sidebar** (`--sidebar-width`, `--color-background-sunken`) is full height and sticky.
  It carries the app name and an _About_ link, and nothing else. There is deliberately no
  section navigation: the archive is one surface.
- **Pane** (`--color-background`) holds the page. Each page opens with a `.rule` (a 1px
  emphasis rule with `--spacing × 4` of padding) and a heading set at body size.

Below `md` the sidebar becomes a static top bar and the pane stacks under it.

The home page reads top to bottom: heading, search field, one row of controls with the
result status right-aligned, then the gallery. The search field is `--control-lg`
(36px); controls are `--control-sm` (28px) and sit 4px under it, labels inline to the
left of their control. Filters that are active also appear as removable tags beneath the
row.

### Gallery

Results are a justified-row gallery. Every image in a row shares one height and the row
fills the pane, so the archive's own proportions set the rhythm. Each `<li>` carries a
`--ratio` (image width ÷ height, clamped to 0.5–3 by `mediaRatio`, falling back to 4:3
when Are.na supplied no dimensions) and flexes as `flex: ratio×100 1 ratio×--row-height`.
A trailing pseudo-element absorbs the last row's slack so a short final row keeps the
target height instead of stretching.

A result shows the image and the block's title beneath it, truncated to one line with an
ellipsis (the full title is the link's `title`). It shows nothing else: no type, source,
date, description, or channel. A block with no image renders a placeholder box holding
its own description, if it has one. Channels are filtered from the form's Channel
control, not from the cards.

## Color

Archivist supports light mode only. There is no dark theme token set, system theme
override, or theme switcher. Keep the explicit `color-scheme: light` declaration so
native controls stay predictable.

Tokens have two tiers in [`src/styles/tokens.css`](../src/styles/tokens.css). The raw tier
is the ramp and accents inherited from the personal site: `--color-white`, `--color-black`,
`--color-gray-50` … `--color-gray-950` in half-steps, and `--color-blue`, `green`,
`paprika`, `pink`, `lilac`, `yellow`. **Components read only the semantic tier**, named by
what they paint:

| Group         | Tokens                                                                                                                                                       | Use                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Surfaces      | `--color-background`, `--color-background-sunken`, `--color-surface`, `--color-surface-hover`                                                                | The pane; the sidebar and image placeholders; text fields; a field on hover or focus.  |
| Text          | `--color-text`, `--color-text-secondary`, `--color-text-tertiary`, `--color-text-placeholder`, `--color-text-disabled`, `--color-text-inverse`               | Headings and emphasis; body and labels; quiet captions and metadata; affordances only. |
| Rules         | `--color-border-subtle`, `--color-border`, `--color-border-emphasis`                                                                                         | Section dividers; control outlines; the rule that opens a region.                      |
| Controls      | `--color-control`, `--color-control-hover`                                                                                                                   | Selects, checkboxes, and tags.                                                         |
| Action, state | `--color-accent`, `--color-accent-strong`, `--color-accent-subtle`, `--color-danger`, `--color-danger-subtle`, `--color-selection`, `--color-selection-text` | Focus, checked state, link hover, errors, text selection.                              |

Body text is `--color-text-secondary` and headings are `--color-text`; this is the whole
type hierarchy. Every text role except placeholder and disabled clears WCAG AA (4.5:1)
against `--color-background`, so `--color-text-tertiary` is the quietest token allowed for
real content (captions, metadata, the result status). The raw `gray-550` and `gray-650`
used for body text on the personal site do not meet AA on this gray canvas, which is why
Archivist maps its text roles to `gray-750` and `gray-700`.

`--color-accent` is the brand blue and is for fills and focus. Where blue is text (link
hover), use `--color-accent-strong`, which is darkened to stay AA. Pair accent color with
text, shape, or position; never rely on color alone. Do not use it to imply that a result
is better or recommended.

Reject gradients, glows, blobs, textures, glass effects, colored rails, and shadows. The
only shadow is `--focus-ring` on a focused field.

## Typography

[`src/styles/fonts.css`](../src/styles/fonts.css) declares two locally hosted faces from
`static/fonts/`: **ABC Areal** (variable, weight 400–700, oblique 0–12°, with a `MONO`
axis) and **Neureal Mono**. `--font-sans` is ABC Areal at `MONO 0`; `--font-mono` is the
same face at `MONO 100`, so code and identifiers stay in the same family. Neureal Mono is
declared for occasional display use and is not loaded unless something references it.

There is one interface size: `--text-base` (13px, 15px leading). Use `--text-article`
(≈14px, 18px leading) only for long-form reading, as on the About page. Headings do not
change size or weight; they are `--color-text` at body size, and structure comes from the
opening rule and whitespace. Emphasis is `--font-weight-medium` on `<strong>` or an
oblique on `<em>`; do not introduce a second size to create hierarchy.

The 13px interface size is intentional and is the floor: do not go smaller, and do not
shrink type to make a layout fit. Rewrite, reorder, or reflow first. Use the mono face only
for operational identifiers, raw tokens, timestamps, and code, never for whole sentences.

Global CSS trims each text box to cap height and baseline (`text-box: trim-both cap
alphabetic`) so heights measure the ink and controls align without per-element nudging.
Do not apply it to an element that also has `overflow: hidden` (descenders are clipped),
as in the gallery captions.

## Rhythm and space

`--spacing` is `0.25rem`, Tailwind's own default, so `p-4` is 1rem and `calc(var(--spacing)

- n)`reads the same in scoped CSS.`--gutter` (12px) is the shared pane and sidebar
padding. The rhythm is tight inside a group (`spacing × 1–3`), and `spacing × 12`between
the page heading, the form, and the gallery. One element owns each gap: prefer a flex or
grid`gap` on the parent over margins on siblings.

Corners are square: there are no radius tokens, and no pills. A tag, control, field, and
image are all rectangles.

## Interaction and accessibility

Use semantic HTML and native controls first. Every form control needs a visible or
programmatically associated label. Use landmarks, one descriptive `h1`, ordered
headings, meaningful link text, visible keyboard focus, and text alternatives for images.

The global focus treatment is a 2px `--color-accent` outline with a 2px offset on every
interactive element, plus `--focus-ring` on text fields. Do not remove it. Disabled
controls use `--color-text-disabled` and must not be interactive.

The channel filter is a native `<details>` disclosure, so it works without JavaScript and
keeps its checkboxes in the form.

Default to stillness. Motion is allowed only when it explains a state change, such as the
gallery dimming while a search is in flight, and must respect `prefers-reduced-motion`.

## CSS architecture

Styling uses Tailwind CSS v4 through `@tailwindcss/vite`. The design tokens _are_ the
Tailwind theme: Tailwind's default palette and scales are deliberately not imported, so a
utility exists only if the design system defines it (`bg-background`, `text-text-secondary`,
`border-border-subtle`, `text-base`, `font-mono`). There is no `bg-red-500`; add a token
first.

Global CSS is layered, with the entry at
[`src/routes/layout.css`](../src/routes/layout.css) declaring
`theme, base, components, utilities`:

1. [`src/styles/fonts.css`](../src/styles/fonts.css) declares the `@font-face` rules.
2. [`src/styles/tokens.css`](../src/styles/tokens.css) is a `@theme static` block of raw
   values and semantic roles. `static` keeps every token available as a `var(--…)` for
   scoped component CSS, not only the ones a utility happens to use.
3. Tailwind's preflight is the reset (`base` layer).
4. [`src/styles/globals.css`](../src/styles/globals.css) sets document defaults, text
   trimming, native controls, selection, and focus inside `@layer base`.
5. [`src/styles/primitives.css`](../src/styles/primitives.css) defines `reading-width`,
   `stack`, `cluster`, `surface`, `rule`, `divider`, `meta`, `mono`, `muted`, and
   `visually-hidden` as `@utility` rules, so they take variants and lose to more specific
   utilities instead of fighting them.

Breakpoints are `sm` 30rem, `md` 45rem, `lg` 60rem, `xl` 75rem. Control heights and
durations have no Tailwind namespace: use `h-(--control-sm)` and
`duration-(--duration-fast)`.

Prefer utilities in markup for one-off layout and spacing. Keep a scoped `<style>` block
when a component has real structure (pseudo-elements, line clamping, child selectors).
Scoped blocks that use `@apply` or `theme()` need `@reference '../../routes/layout.css';`.
Unlayered scoped CSS beats every utility, so do not put a scoped rule and a utility on the
same property. Class order is enforced by `prettier-plugin-tailwindcss` (`bun run
format`). Keep provider-specific data shapes and search behavior out of CSS.

## Archive evidence

The archive is the visual material. Result cards must preserve original Are.na identity
and link to the canonical block. Never invent captions, tags, image descriptions, or
source metadata.

Use imagery at a stable aspect ratio to prevent layout shift, and let the source image
carry the visual weight. For exact lookup, use semantic tables with captions and column
headers; do not use a table-like treatment for the gallery.

## Things to avoid

- Dark-mode branches, `prefers-color-scheme` overrides, or visible theme controls.
- Decorative gradients, glows, blobs, textures, shadows, or fake depth.
- More than one type size for hierarchy, all-caps overlines, or decorative numbering.
- Rounded corners, pills, or cards nested inside cards.
- Reaching past a semantic color role to a raw gray.
- Section navigation in the sidebar, or marketing copy above the search field.
- Generated descriptions, tags, captions, or other metadata for original blocks.
- Icons used as decoration or a new icon system added for visual polish.
- CSS that leaks provider concerns into the UI or makes Turbopuffer a visual API.
