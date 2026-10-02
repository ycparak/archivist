import {
	ARCHIVE_RESULT_LIMIT,
	type ArchiveBlockType,
	type ArchiveSearchState,
	type SearchResult,
	type SearchTimings
} from '$lib/domain/search';

const FALLBACK_MEDIA_RATIO = 4 / 3;
const MIN_MEDIA_RATIO = 0.5;
const MAX_MEDIA_RATIO = 3;

export function mediaRatio(result: Pick<SearchResult, 'imageWidth' | 'imageHeight'>): number {
	const { imageWidth, imageHeight } = result;
	if (!imageWidth || !imageHeight) return FALLBACK_MEDIA_RATIO;
	return Math.min(MAX_MEDIA_RATIO, Math.max(MIN_MEDIA_RATIO, imageWidth / imageHeight));
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

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

export function formatSearchTimings({ totalMs, queryMs, rerankMs }: SearchTimings): string {
	return `time: ${seconds(totalMs)} (query: ${seconds(queryMs)}, rerank: ${seconds(rerankMs)})`;
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
		state.channelSlugs.length +
		state.blockTypes.length +
		state.colours.length +
		(state.from || state.to ? 1 : 0);
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
