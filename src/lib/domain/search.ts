export const ARCHIVE_BLOCK_TYPES = ['Image', 'Link', 'Text', 'Attachment', 'Embed'] as const;

export type ArchiveBlockType = (typeof ARCHIVE_BLOCK_TYPES)[number];

export const ARCHIVE_SEARCH_PARAM = {
	query: 'q',
	mode: 'mode',
	channel: 'channel',
	type: 'type',
	from: 'from',
	to: 'to'
} as const;

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
	from: string;
	to: string;
};

export const emptyArchiveSearchState: ArchiveSearchState = {
	query: '',
	mode: 'browse',
	channelSlugs: [],
	blockTypes: [],
	from: '',
	to: ''
};

export function defaultSearchMode(query: string): ArchiveSearchMode {
	return query.trim() ? 'hybrid' : 'browse';
}

export type ArchiveSearchHref = '/' | `/?${string}`;

export function toArchiveSearchHref(state: ArchiveSearchState): ArchiveSearchHref {
	const query = state.query.trim();
	const params = new URLSearchParams();

	if (query) params.set(ARCHIVE_SEARCH_PARAM.query, query);
	if (query && state.mode !== defaultSearchMode(query)) {
		params.set(ARCHIVE_SEARCH_PARAM.mode, state.mode);
	}
	for (const slug of state.channelSlugs) params.append(ARCHIVE_SEARCH_PARAM.channel, slug);
	for (const blockType of state.blockTypes) params.append(ARCHIVE_SEARCH_PARAM.type, blockType);
	if (state.from) params.set(ARCHIVE_SEARCH_PARAM.from, state.from);
	if (state.to) params.set(ARCHIVE_SEARCH_PARAM.to, state.to);

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

function isArchiveSearchMode(value: string): value is ArchiveSearchMode {
	return (ARCHIVE_SEARCH_MODES as readonly string[]).includes(value);
}

export function readArchiveSearchState(searchParams: URLSearchParams): ArchiveSearchState {
	const query = readSingle(searchParams, ARCHIVE_SEARCH_PARAM.query);
	const requestedMode = readSingle(searchParams, ARCHIVE_SEARCH_PARAM.mode);

	return {
		query,
		mode: isArchiveSearchMode(requestedMode) ? requestedMode : defaultSearchMode(query),
		channelSlugs: readRepeated(searchParams, ARCHIVE_SEARCH_PARAM.channel),
		blockTypes: readRepeated(searchParams, ARCHIVE_SEARCH_PARAM.type).filter(isArchiveBlockType),
		from: readDate(searchParams, ARCHIVE_SEARCH_PARAM.from),
		to: readDate(searchParams, ARCHIVE_SEARCH_PARAM.to)
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
	return Boolean(state.channelSlugs.length || state.blockTypes.length || state.from || state.to);
}

export function withChannel(state: ArchiveSearchState, slug: string): ArchiveSearchState {
	if (state.channelSlugs.includes(slug)) return state;
	return { ...state, channelSlugs: [...state.channelSlugs, slug] };
}
