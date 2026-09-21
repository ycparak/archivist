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

1. What archive am I looking at?
2. Can I search or browse it immediately?
3. What did the archive return?
4. What is the original block and where can I inspect it further?

Do not add copy, panels, metadata, or interactions that do not support that job.

## Visual thesis

Use a light-only, editorial archive surface: a white canvas, near-black text, a
quiet neutral ramp, thin rules, generous outer margins, and restrained use of a
deep green accent for meaningful actions or state. Let typography, alignment,
image density, and whitespace create presence. Surfaces and borders should explain
grouping or interaction, not decorate an otherwise weak hierarchy.

This combines three reference behaviors:

- Dimsum: a compact, explicit token system; semantic color aliases; 28–40px
  controls; restrained 4–16px radii; clear interface and paragraph line-height
  tiers; and a sans/mono type pairing.
- LLTG: a sparse archive introduction; a narrow readable measure; quiet tertiary
  metadata; thin horizontal rules; image-led rows; and a compact table-like
  information rhythm.
- Vercel’s design guidance: begin with the reader’s job, establish one focal
  relationship, prefer hierarchy over containers, keep evidence semantic, make
  responsive reflow intentional, and reject decorative effects.

## Color

Archivist supports light mode only. There is no dark theme token set, system theme
override, or theme switcher. Keep the explicit `color-scheme: light` declaration
so native controls and form affordances remain predictable.

Use the raw neutral ramp only to define semantic aliases. Components should read
semantic variables wherever possible:

| Role                              | Token                                                 |
| --------------------------------- | ----------------------------------------------------- |
| Page canvas                       | `--color-background`                                  |
| Secondary canvas or quiet surface | `--color-background-subtle`, `--color-surface-raised` |
| Main text                         | `--color-text`                                        |
| Supporting text                   | `--color-text-secondary`, `--color-text-tertiary`     |
| Placeholder and disabled text     | `--color-text-placeholder`, `--color-text-disabled`   |
| Quiet and standard rules          | `--color-border-subtle`, `--color-border`             |
| Emphasized rule                   | `--color-border-emphasis`                             |
| Action or meaningful state        | `--color-accent`, `--color-accent-strong`             |
| Hover for a filled accent control | `--color-accent-hover`                                |
| Error                             | `--color-danger`, `--color-danger-subtle`             |
| Native control surface            | `--color-control`, `--color-control-hover`            |

Body, label, and metadata text must clear WCAG AA (4.5:1) against its surface. `--color-text-tertiary`
is the quietest token allowed for real content; `--color-text-placeholder` and `--color-text-disabled`
are for placeholder and disabled affordances only. A filled accent control darkens on hover
(`--color-accent-hover`) rather than lightening, so its label does not lose contrast.

Color must carry meaning. Pair accent color with text, shape, position, or an
accessible label; never rely on color alone. Do not use green to imply that a
result is better, more relevant, or recommended unless the product has an
explicit, sourced state that requires it.

Reject gradients, glows, blobs, textures, glass effects, colored rails, and
ornamental shadows. The single subtle shadow token is reserved for a future
surface that genuinely needs separation from the canvas.

## Typography

Use the system sans stack for prose, headings, labels, controls, dates, counts,
and result metadata. Use the mono stack only for operational identifiers, raw
tokens, timestamps, code, or other intentionally technical values. Do not use
mono for a whole sentence or entire card just to create texture.

| Role       | Token                            | Use                                           |
| ---------- | -------------------------------- | --------------------------------------------- |
| Body       | `--text-md`                      | Default reading text and primary result copy. |
| Small      | `--text-sm`                      | Labels and secondary controls.                |
| Metadata   | `--text-meta`                    | Quiet source, date, type, and count context.  |
| Large body | `--text-lg`                      | Short introductory or lead copy.              |
| Headings   | `--text-xl` through `--text-3xl` | Structural hierarchy only.                    |

Keep body text at or above 1rem, regular labels at or above 0.875rem, and
metadata at or above 0.8125rem. Do not shrink type to make a layout fit. Rewrite,
reorder, or reflow first.

Use `--leading-tight` for headings, `--leading-interface` for controls and
metadata, and `--leading-copy` for readable text. Headings use the small negative
tracking token; body copy uses the slight positive tracking token. Keep prose near
a comfortable reading measure instead of filling every available column.

Visible headings use sentence case and should name a real reader question or
archive relationship. Avoid all-caps overlines, decorative numbered sections,
generic taglines, and internal implementation language.

## Layout and rhythm

Use a shared content edge. `.container` owns the responsive outer gutter and
maximum width; `.reading-width` limits prose; `.stack`, `.cluster`, and Tailwind's
`grid` own relationships between children. Every gap should have one owner. Group
related content before applying a stack or grid rather than repairing siblings
with arbitrary margins.

The default rhythm is compact within a group and more generous between groups:

- `--space-2` through `--space-6`: label/value or inline control relationships.
- `--space-8` through `--space-12`: related content groups.
- `--space-16` and above: meaningful section or chapter changes only.

On desktop, allow the gallery and evidence surfaces to use the full content width.
Keep introductory prose narrower. On smaller screens, preserve readable text and
control sizes, stack secondary columns, and allow long data to scroll locally only
when reordering cannot preserve lookup. Never create horizontal page overflow.

## Surfaces and boundaries

Prefer one continuous canvas. Use `.surface` only when a real grouping, selection,
warning, or interactive boundary cannot be communicated with spacing and
alignment. Do not wrap every result, metric, or section in a card, and do not nest
cards inside cards.

Use `.divider` for quiet editorial separation and semantic `<hr>` where the
document structure calls for a thematic break. Keep radii consistent: small for
controls, medium for ordinary controls and compact surfaces, and large only for a
substantial grouped surface. Pills are reserved for true binary or status states,
not ordinary metadata.

## Archive evidence

The archive is the visual material. Result cards must preserve original Are.na
identity and link to the canonical block. Never invent captions, tags, image
descriptions, or source metadata.

Use imagery at a stable aspect ratio with explicit dimensions to prevent layout
shift. Keep image treatment quiet and let the source image carry the visual weight.
Metadata should be subordinate: block type, channel, source title, and dates are
useful context, not decoration.

For exact lookup, use semantic tables with captions, column headers, and aligned
numeric values. Do not use a table-like visual treatment for arbitrary card grids.
Keep a gallery visually dense enough to browse, but do not add ornamental labels
or repetitive statistics to fill space.

## Interaction and accessibility

Use semantic HTML and native controls first. Every form control needs a visible or
programmatically associated label. Use landmarks, one descriptive `h1`, ordered
headings, meaningful link text, visible keyboard focus, and text alternatives for
images. Never rely on color alone to communicate state.

The global focus ring is `--focus-ring`. Do not remove it or replace it with a
subtle color shift. Disabled controls must remain legible enough to understand
their purpose and must not be treated as interactive.

Default to stillness. Motion is allowed only when it explains a state change or
confirms an action. It must not gate content, move imagery for decoration, or
introduce auto-scrolling. Add reduced-motion handling if a future interaction
introduces transitions.

## CSS architecture

Styling uses Tailwind CSS v4 through `@tailwindcss/vite`. The design tokens _are_ the
Tailwind theme: Tailwind's default palette and scales are deliberately not imported, so a
utility exists only if the design system defines it (`bg-background`, `text-text-secondary`,
`border-border-subtle`, `text-meta`, `rounded-md`, `leading-copy`, `tracking-heading`,
`font-mono`, `ease-standard`). There is no `bg-red-500`; add a token first.

Global CSS is layered, with the entry at
[`src/routes/layout.css`](../src/routes/layout.css) declaring
`theme, base, components, utilities`:

1. [`src/styles/tokens.css`](../src/styles/tokens.css) is a `@theme static` block of raw
   values and semantic aliases. `static` keeps every token available as a `var(--…)` for
   scoped component CSS, not only the ones a utility happens to use.
2. Tailwind's preflight is the reset (`base` layer).
3. [`src/styles/globals.css`](../src/styles/globals.css) sets document defaults, native
   controls, and focus behavior inside `@layer base`.
4. [`src/styles/primitives.css`](../src/styles/primitives.css) defines `container`,
   `reading-width`, `stack`, `cluster`, `surface`, `divider`, `meta`, `eyebrow`, `muted`,
   and `visually-hidden` as `@utility` rules, so they take variants (`md:stack`) and lose
   to more specific utilities instead of fighting them.

Spacing: `--spacing` is `0.125rem`, so `p-4` is `--space-4` (0.5rem) and the numbers in
this document match the utilities. This differs from Tailwind's default, where `p-4` is 1rem.
Text sizes follow the `--text-*` names (`text-md`, `text-meta`, `text-3xl`). Durations and
control heights have no Tailwind namespace: use `duration-(--duration-fast)` and
`h-(--control-md)`. Breakpoints are `sm` 30rem, `md` 48rem, `lg` 64rem, `xl` 80rem.

Prefer utilities in markup for one-off layout and spacing. Keep a scoped `<style>` block
when a component has real structure (pseudo-elements, line clamping, child selectors).
Scoped blocks that use `@apply` or `theme()` need `@reference '../../routes/layout.css';`.
Unlayered scoped CSS beats every utility, so do not put a scoped rule and a utility on the
same property. Class order is enforced by `prettier-plugin-tailwindcss` (`bun run format`).
Keep provider-specific data shapes and search behavior out of CSS.

## Things to avoid

- Dark-mode branches, `prefers-color-scheme` overrides, or visible theme controls.
- Decorative gradients, glows, blobs, textures, or fake depth.
- Oversized marketing heroes before the search/browse surface.
- Tiny muted copy, arbitrary one-off font sizes, or inconsistent peer treatment.
- Cards nested inside cards or borders used to compensate for weak hierarchy.
- Generated descriptions, tags, captions, or other metadata for original blocks.
- Icons used as decoration or a new icon system added for visual polish.
- CSS that leaks provider concerns into the UI or makes Turbopuffer a visual API.

## References

- [Dimsum component library](https://dimsum.systems/)
- [LLTG archive](https://lltg.co/)
- [Vercel design guidance](https://vercel.com/design.md)
