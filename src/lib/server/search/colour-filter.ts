import type { ArchiveColour } from '$lib/domain/search';

/**
 * The per-mille share at which a block counts as having a colour. Set here rather than at index
 * time, so tuning one needs a deploy but never a re-sync. `mono` is the inverse: it is near 1000 only
 * when there is almost no colour at all.
 */
export const COLOUR_THRESHOLDS: Readonly<Record<ArchiveColour, number>> = {
	red: 10,
	orange: 10,
	yellow: 10,
	green: 10,
	blue: 10,
	purple: 10,
	pink: 10,
	brown: 10,
	grey: 150,
	black: 150,
	white: 150,
	mono: 995
};

/**
 * When a colour leads the browse order, weaker matches sink to the end of the scroll instead of
 * being cut, so any of the colour at all is enough. `mono` keeps its threshold, because near 1000 is
 * what black and white means, and almost every image has some.
 */
export function colourThreshold(colour: ArchiveColour, leadsOrder: boolean): number {
	return leadsOrder && colour !== 'mono' ? 1 : COLOUR_THRESHOLDS[colour];
}
