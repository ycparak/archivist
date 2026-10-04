/**
 * What a block is, as a reader would put it. Not Are.na's own block types: a video or animated GIF
 * is pulled out of whatever block holds it, and a Link is a Web page. The sync stores it as `kind`.
 */
export const ARCHIVE_BLOCK_TYPES = [
	'Image',
	'Video',
	'GIF',
	'Web',
	'Text',
	'Attachment',
	'Embed'
] as const;

export type ArchiveBlockType = (typeof ARCHIVE_BLOCK_TYPES)[number];

/** `mono` is the absence of colour, shown as "Black & white"; the rest are measured hues and neutrals. */
export const ARCHIVE_COLOURS = [
	'red',
	'orange',
	'yellow',
	'green',
	'blue',
	'purple',
	'pink',
	'brown',
	'grey',
	'black',
	'white',
	'mono'
] as const;

export type ArchiveColour = (typeof ARCHIVE_COLOURS)[number];

/** Colours combine with AND; each one also sorts browse results, and Turbopuffer sorts on at most 8. */
export const ARCHIVE_MAX_COLOURS = 5;

export const ARCHIVE_SEARCH_PARAM = {
	query: 'q',
	mode: 'mode',
	channel: 'channel',
	type: 'type',
	colour: 'colour',
	from: 'from',
	to: 'to',
	createdFrom: 'created_from',
	createdTo: 'created_to',
	sort: 'sort'
} as const;

/**
 * Browse order, in the order the gallery lists it. The `my-` orders count only the maintainer's
 * channels; `most-connected` counts every connection on Are.na. `my-most-connected` is the default,
 * so it never appears in a URL. A text query ranks by relevance instead.
 */
export const ARCHIVE_SORTS = [
	'my-most-connected',
	'my-least-connected',
	'my-newest-connected',
	'my-oldest-connected',
	'most-connected',
	'newest-created',
	'oldest-created'
] as const;

export type ArchiveSort = (typeof ARCHIVE_SORTS)[number];

export const ARCHIVE_DEFAULT_SORT: ArchiveSort = 'my-most-connected';

export const ARCHIVE_PAGE_PARAM = { offset: 'offset' } as const;

export const ARCHIVE_SEARCH_MODES = ['browse', 'lexical', 'semantic', 'hybrid'] as const;

export const ARCHIVE_RESULT_LIMIT = 24;
export const ARCHIVE_MAX_OFFSET = 2000;

export type ArchiveSearchMode = (typeof ARCHIVE_SEARCH_MODES)[number];

export type SearchResult = {
	id: string;
	title: string | null;
	description: string | null;
	blockType: string;
	channelSlugs: string[];
	connectedAt: string | null;
	sourceUrl: string | null;
	arenaUrl: string;
	imageUrl: string | null;
	imageAlt: string | null;
	imageWidth: number | null;
	imageHeight: number | null;
	videoUrl: string | null;
	videoContentType: string | null;
	sourceTitle: string | null;
};

export type SearchTimings = {
	totalMs: number;
	queryMs: number;
	rerankMs: number;
};

export type ChannelManifestEntry = {
	slug: string;
	title: string;
};

export type ArchiveSearchState = {
	query: string;
	mode: ArchiveSearchMode;
	channelSlugs: string[];
	blockTypes: ArchiveBlockType[];
	colours: ArchiveColour[];
	from: string;
	to: string;
	createdFrom: string;
	createdTo: string;
	sort: ArchiveSort;
};

export const emptyArchiveSearchState: ArchiveSearchState = {
	query: '',
	mode: 'browse',
	channelSlugs: [],
	blockTypes: [],
	colours: [],
	from: '',
	to: '',
	createdFrom: '',
	createdTo: '',
	sort: ARCHIVE_DEFAULT_SORT
};

export function defaultSearchMode(query: string): ArchiveSearchMode {
	return query.trim() ? 'hybrid' : 'browse';
}

/**
 * The ranking a search runs with. Without a query there is nothing to rank, so it browses; a
 * ranking chosen beforehand is kept in the URL and applies once a query arrives.
 */
export function effectiveSearchMode(query: string, mode: ArchiveSearchMode): ArchiveSearchMode {
	return query.trim() ? mode : 'browse';
}

export type ArchiveSearchHref = '/' | `/?${string}`;

export function toArchiveSearchHref(state: ArchiveSearchState): ArchiveSearchHref {
	const query = state.query.trim();
	const params = new URLSearchParams();

	if (query) params.set(ARCHIVE_SEARCH_PARAM.query, query);
	const remembersRanking = state.mode === 'lexical' || state.mode === 'semantic';
	if (query ? state.mode !== defaultSearchMode(query) : remembersRanking) {
		params.set(ARCHIVE_SEARCH_PARAM.mode, state.mode);
	}
	for (const slug of state.channelSlugs) params.append(ARCHIVE_SEARCH_PARAM.channel, slug);
	for (const blockType of state.blockTypes) params.append(ARCHIVE_SEARCH_PARAM.type, blockType);
	for (const colour of state.colours) params.append(ARCHIVE_SEARCH_PARAM.colour, colour);
	if (state.from) params.set(ARCHIVE_SEARCH_PARAM.from, state.from);
	if (state.to) params.set(ARCHIVE_SEARCH_PARAM.to, state.to);
	if (state.createdFrom) params.set(ARCHIVE_SEARCH_PARAM.createdFrom, state.createdFrom);
	if (state.createdTo) params.set(ARCHIVE_SEARCH_PARAM.createdTo, state.createdTo);
	const browsing = effectiveSearchMode(query, state.mode) === 'browse';
	if (browsing && state.sort !== ARCHIVE_DEFAULT_SORT) {
		params.set(ARCHIVE_SEARCH_PARAM.sort, state.sort);
	}

	const search = params.toString();
	return search ? `/?${search}` : '/';
}

function readSingle(searchParams: URLSearchParams, name: string): string {
	return searchParams.get(name)?.trim() ?? '';
}

function readRepeated(searchParams: URLSearchParams, name: string): string[] {
	return [
		...new Set(
			searchParams
				.getAll(name)
				.map((value) => value.trim())
				.filter(Boolean)
		)
	];
}

function readDate(searchParams: URLSearchParams, name: string): string {
	const value = readSingle(searchParams, name);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) return '';
	return parsed.toISOString().slice(0, 10) === value ? value : '';
}

function isArchiveBlockType(value: string): value is ArchiveBlockType {
	return (ARCHIVE_BLOCK_TYPES as readonly string[]).includes(value);
}

function isArchiveColour(value: string): value is ArchiveColour {
	return (ARCHIVE_COLOURS as readonly string[]).includes(value);
}

function isArchiveSort(value: string): value is ArchiveSort {
	return (ARCHIVE_SORTS as readonly string[]).includes(value);
}

function isArchiveSearchMode(value: string): value is ArchiveSearchMode {
	return (ARCHIVE_SEARCH_MODES as readonly string[]).includes(value);
}

export function readArchiveSearchState(searchParams: URLSearchParams): ArchiveSearchState {
	const query = readSingle(searchParams, ARCHIVE_SEARCH_PARAM.query);
	const requestedMode = readSingle(searchParams, ARCHIVE_SEARCH_PARAM.mode);
	const requestedSort = readSingle(searchParams, ARCHIVE_SEARCH_PARAM.sort);

	return {
		query,
		mode: isArchiveSearchMode(requestedMode) ? requestedMode : defaultSearchMode(query),
		channelSlugs: readRepeated(searchParams, ARCHIVE_SEARCH_PARAM.channel),
		blockTypes: readRepeated(searchParams, ARCHIVE_SEARCH_PARAM.type).filter(isArchiveBlockType),
		colours: readRepeated(searchParams, ARCHIVE_SEARCH_PARAM.colour)
			.filter(isArchiveColour)
			.slice(0, ARCHIVE_MAX_COLOURS),
		from: readDate(searchParams, ARCHIVE_SEARCH_PARAM.from),
		to: readDate(searchParams, ARCHIVE_SEARCH_PARAM.to),
		createdFrom: readDate(searchParams, ARCHIVE_SEARCH_PARAM.createdFrom),
		createdTo: readDate(searchParams, ARCHIVE_SEARCH_PARAM.createdTo),
		sort: isArchiveSort(requestedSort) ? requestedSort : ARCHIVE_DEFAULT_SORT
	};
}

export function readArchiveSearchStateFromEntries(
	entries: Iterable<[string, string]>
): ArchiveSearchState {
	const params = new URLSearchParams();
	for (const [name, value] of entries) params.append(name, value);
	return readArchiveSearchState(params);
}

export function hasActiveFilters(state: ArchiveSearchState): boolean {
	return Boolean(
		state.channelSlugs.length ||
		state.blockTypes.length ||
		state.colours.length ||
		state.from ||
		state.to ||
		state.createdFrom ||
		state.createdTo
	);
}
