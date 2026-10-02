import { z } from 'zod';
import {
	ARCHIVE_BLOCK_TYPES,
	ARCHIVE_COLOURS,
	ARCHIVE_DEFAULT_SORT,
	ARCHIVE_MAX_COLOURS,
	ARCHIVE_MAX_OFFSET,
	ARCHIVE_SEARCH_MODES,
	ARCHIVE_SORTS,
	type SearchResult,
	type SearchTimings
} from '$lib/domain/search';

export type { SearchResult, SearchTimings };

export const searchResultSchema: z.ZodType<SearchResult> = z.object({
	id: z.string(),
	title: z.string().nullable(),
	description: z.string().nullable(),
	blockType: z.string(),
	channelSlugs: z.array(z.string()),
	connectedAt: z.string().nullable(),
	sourceUrl: z.url().nullable(),
	arenaUrl: z.url(),
	imageUrl: z.url().nullable(),
	imageAlt: z.string().nullable(),
	imageWidth: z.number().int().positive().nullable(),
	imageHeight: z.number().int().positive().nullable(),
	videoUrl: z.url().nullable(),
	videoContentType: z.string().nullable(),
	sourceTitle: z.string().nullable()
});

export const searchModeSchema = z.enum(ARCHIVE_SEARCH_MODES);

export const archiveSearchInputSchema = z.object({
	mode: searchModeSchema.default('hybrid'),
	query: z.string().trim().max(400).default(''),
	channelSlugs: z.array(z.string().trim().min(1)).max(20).default([]),
	blockTypes: z.array(z.enum(ARCHIVE_BLOCK_TYPES)).max(20).default([]),
	colours: z.array(z.enum(ARCHIVE_COLOURS)).max(ARCHIVE_MAX_COLOURS).default([]),
	from: z.coerce.date().optional(),
	to: z.coerce.date().optional(),
	createdFrom: z.coerce.date().optional(),
	createdTo: z.coerce.date().optional(),
	sort: z.enum(ARCHIVE_SORTS).default(ARCHIVE_DEFAULT_SORT),
	limit: z.number().int().min(1).max(48).default(24),
	offset: z.number().int().min(0).max(ARCHIVE_MAX_OFFSET).default(0)
});

export type ArchiveSearchInput = z.infer<typeof archiveSearchInputSchema>;

export const searchSuccessResponseSchema = z.object({
	results: z.array(searchResultSchema),
	hasMore: z.boolean()
});

export interface SearchResponse {
	results: SearchResult[];
	timings: SearchTimings;
}

export interface SearchRepository {
	search(input: ArchiveSearchInput): Promise<SearchResponse>;
}

export interface ArchiveSizeSource {
	countBlocks(): Promise<number>;
}
