import { ARCHIVE_RESULT_LIMIT, type ArchiveSearchState } from '$lib/domain/search';

/** Keyed by Are.na's own block type, which results carry, not the gallery's Block type. */
const UNTITLED_LABELS: Record<string, string> = {
	Image: 'Untitled image',
	Link: 'Untitled link',
	Text: 'Untitled text',
	Attachment: 'Untitled attachment',
	Embed: 'Untitled embed'
};

export function blockDisplayTitle(title: string | null, blockType: string): string {
	if (title) return title;
	return UNTITLED_LABELS[blockType] ?? 'Untitled block';
}

/**
 * A channel title as the gallery shows it: without the symbols the maintainer prefixes titles with
 * on Are.na (`✦ `, `❋ `, ``). Some of those are letters of other scripts (`𖤛` is Bamum), so
 * everything before the first Latin letter or digit goes. A title with neither is kept whole.
 */
export function channelLabel(title: string): string {
	return title.replace(/^[^\p{Script=Latin}\p{N}]+/u, '') || title;
}

/** The symbol `channelLabel` takes off a channel title, or null when the title has none. */
export function channelSymbol(title: string): string | null {
	const label = channelLabel(title);
	if (label === title) return null;
	return title.slice(0, title.length - label.length).trim() || null;
}

const count = new Intl.NumberFormat('en');

export function archiveCount(value: number, noun: string): string {
	return `${count.format(value)} ${noun}${value === 1 ? '' : 's'}`;
}

type ResultsStatusInput = {
	kind: 'ok' | 'invalid' | 'unavailable';
	state: ArchiveSearchState;
	resultCount: number;
	searching: boolean;
};

export function resultsStatus({ kind, state, resultCount, searching }: ResultsStatusInput): string {
	const subject = state.query ? `for \u201c${state.query}\u201d` : 'in the archive';
	const filterCount =
		state.channelSlugs.length +
		state.blockTypes.length +
		state.colours.length +
		(state.from || state.to ? 1 : 0) +
		(state.createdFrom || state.createdTo ? 1 : 0);
	const filters = filterCount ? ` with ${filterCount} filter${filterCount === 1 ? '' : 's'}` : '';

	if (searching) return `Searching ${subject}${filters}\u2026`;
	if (kind === 'unavailable') return 'Search is unavailable right now.';
	if (kind === 'invalid') return 'That search could not be read.';
	if (!resultCount) return `No blocks ${subject}${filters}.`;
	if (resultCount >= ARCHIVE_RESULT_LIMIT) {
		return `Showing the first ${ARCHIVE_RESULT_LIMIT} blocks ${subject}${filters}.`;
	}
	return `${resultCount} block${resultCount === 1 ? '' : 's'} ${subject}${filters}.`;
}
