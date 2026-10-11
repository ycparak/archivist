# Search submission

- Task: Submit search on Enter or blur.
- Reviewed SearchField.svelte, svelte-guidelines.md and agent-loop.md.
- Removed the debounce timer; input changes only update the draft. Enter and blur use the existing deduplicated URL navigation. Blur to the clear button is skipped so clearing sends only the empty query.
- Validation: check, lint, 641 tests (2 existing skips) and build passed. Build required sandbox escalation for its local Cloudflare listener. Browser checks confirmed typing leaves the URL unchanged, Enter and clicking away submit, and clear discards an unsubmitted draft. Svelte autofixer reported no issues; its suggestions concern the existing URL-to-draft synchronization and textarea reference.
- This small event-handler change used the trivial-fix workflow; interactive behavior was verified in the browser rather than adding a component test harness.
