import type { ArchiveColour } from '$lib/domain/search';

/**
 * The per-mille share at which a block counts as having a colour. Set here rather than at index
 * time, so tuning one needs a deploy but never a re-sync. `mono` is the inverse: it is near 1000 only
 * when there is almost no colour at all.
 */
export const COLOUR_THRESHOLDS: Readonly<Record<ArchiveColour, number>> = {
	red: 50,
	orange: 50,
	yellow: 50,
	green: 50,
	blue: 50,
	purple: 50,
	pink: 50,
	brown: 50,
	grey: 150,
	black: 150,
	white: 150,
	mono: 995
};
