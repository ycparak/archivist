import {
	ARCHIVE_RESULT_LIMIT,
	type ArchiveBlockType,
	type ArchiveSearchState
} from '$lib/domain/search';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatArchiveDate(value: string | null): string | null {
	if (!value) return null;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return null;
	return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

const UNTITLED_LABELS: Record<ArchiveBlockType, string> = {
	Image: 'Untitled image',
	Link: 'Untitled link',
	Text: 'Untitled text',
	Attachment: 'Untitled attachment',
	Embed: 'Untitled embed'
};

export function blockDisplayTitle(title: string | null, blockType: string): string {
	if (title) return title;
	return UNTITLED_LABELS[blockType as ArchiveBlockType] ?? 'Untitled block';
}

export type ResultsStatusInput = {
	kind: 'ok' | 'invalid' | 'unavailable';
	state: ArchiveSearchState;
	resultCount: number;
	searching: boolean;
};

export function resultsStatus({ kind, state, resultCount, searching }: ResultsStatusInput): string {
	const subject = state.query ? `for \u201c${state.query}\u201d` : 'in the archive';
	const filterCount =
		state.channelSlugs.length + state.blockTypes.length + (state.from || state.to ? 1 : 0);
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
