import type { Attachment } from 'svelte/attachments';

/**
 * Marks an element `data-revealed` the first time it scrolls into the shelf, which starts its
 * entrance transition. The hidden starting state only applies once the document is flagged
 * `data-js`, so without JavaScript everything is simply visible.
 */
export const reveal: Attachment<HTMLElement> = (element) => {
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		element.dataset.revealed = '';
		return;
	}
	const observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			element.dataset.revealed = '';
			observer.disconnect();
		},
		{ root: element.closest('[data-shelf-scroller]') }
	);
	observer.observe(element);
	return () => observer.disconnect();
};
