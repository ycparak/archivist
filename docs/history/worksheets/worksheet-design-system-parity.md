# Design system parity worksheet

Reviewed both AGENTS files, design docs, source font/theme definitions, SiteAbout, Button, ASCII controls, Archivist index/search/slider and pretext measurement.

Plan: retain responsive root/serif tokens; make spacing unit explicit in px, align sans body tokens and font axes, copy palette definitions, add reusable button styling and adapt dual range slider visuals. Keep existing cap-derived gaps and line stacks; measurement reads computed type so it follows the new rhythm. Update design docs and changelog. Validate check/lint/test/build and browser desktop/mobile.

Risk: more line height may require additional filter columns; preserve pretext fitting and verify clipping and keyboard controls. No search or indexing changes.

## Result and validation

Implemented fixed sans 13.2px / 15px, regular strong-colour headings, source palette/font defaults, 4px spacing, reusable capsule controls and ASCII slider primitives. Preserved Newsreader font definitions, responsive sizes and line heights. Kept cap-aware rhythm rather than introducing fixed text margins. Short-screen annotation bands contract to avoid observed ranking overflow.

Check and lint passed; test: 42 files, 641 passed, 2 existing skipped. Production build passed with local socket permission (sandbox initially blocked listen). Official Svelte autofixer reported no issues; SearchField suggestions refer to unchanged draft/effect and bind:this behavior, retained to preserve newer-keystroke handling.

Browser: Chromium hard load, range keyboard URL commit, query and clear, desktop 1280x720/900/600, phone 390x844/667, no console errors. Computed desktop serif search22.5px/30px and wordmark28.125px/33.75px unchanged. Short600px filter section client/scroll heights415px match after layout correction. Frontend and QA reviews completed; hover contrast uses gray200 light/gray800 dark. Firefox rendering, coincident-thumb pointer interaction and dark-mode visual inspection remain unverified.
