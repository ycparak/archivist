import { z } from 'zod';
import { ARCHIVE_BLOCK_TYPES, type ArchiveBlockType } from './archive';

export const ARCHIVE_SEARCH_PARAM = {
	query: 'q',
	mode: 'mode',
	channel: 'channel',
	type: 'type',
	from: 'from',
	to: 'to'
} as const;

export const ARCHIVE_SEARCH_MODES = ['browse', 'lexical', 'semantic', 'hybrid'] as const;

export const ARCHIVE_RESULT_LIMIT = 24;

export type ArchiveSearchMode = (typeof ARCHIVE_SEARCH_MODES)[number];

export const searchResultSchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	description: z.string().nullable(),
	blockType: z.string(),
	channelSlugs: z.array(z.string()),
	connectedAt: z.string().nullable(),
	sourceUrl: z.url().nullable(),
	arenaUrl: z.url(),
	imageUrl: z.url().nullable(),
	sourceTitle: z.string().nullable()
});

export type SearchResult = z.infer<typeof searchResultSchema>;

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
	return searchParams
		.getAll(name)
		.map((value) => value.trim())
		.filter(Boolean);
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
		from: readSingle(searchParams, ARCHIVE_SEARCH_PARAM.from),
		to: readSingle(searchParams, ARCHIVE_SEARCH_PARAM.to)
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

export function withoutChannel(state: ArchiveSearchState, slug: string): ArchiveSearchState {
	return { ...state, channelSlugs: state.channelSlugs.filter((value) => value !== slug) };
}

export function withChannel(state: ArchiveSearchState, slug: string): ArchiveSearchState {
	if (state.channelSlugs.includes(slug)) return state;
	return { ...state, channelSlugs: [...state.channelSlugs, slug] };
}

export function withoutBlockType(
	state: ArchiveSearchState,
	blockType: ArchiveBlockType
): ArchiveSearchState {
	return { ...state, blockTypes: state.blockTypes.filter((value) => value !== blockType) };
}

export function withoutDateRange(state: ArchiveSearchState): ArchiveSearchState {
	return { ...state, from: '', to: '' };
}

export function withoutFilters(state: ArchiveSearchState): ArchiveSearchState {
	return { ...state, channelSlugs: [], blockTypes: [], from: '', to: '' };
}
