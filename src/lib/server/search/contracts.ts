import { z } from 'zod';

export const searchModeSchema = z.enum(['browse', 'lexical', 'semantic', 'hybrid']);

export const archiveSearchInputSchema = z.object({
	mode: searchModeSchema.default('hybrid'),
	query: z.string().trim().max(400).default(''),
	channelSlugs: z.array(z.string().trim().min(1)).max(20).default([]),
	blockTypes: z.array(z.string().trim().min(1)).max(20).default([]),
	from: z.coerce.date().optional(),
	to: z.coerce.date().optional(),
	limit: z.number().int().min(1).max(48).default(24)
});

export type ArchiveSearchInput = z.infer<typeof archiveSearchInputSchema>;

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

export const searchSuccessResponseSchema = z.object({ results: z.array(searchResultSchema) });

export const searchErrorResponseSchema = z.object({
	error: z.string(),
	correlationId: z.string().optional()
});

export interface SearchRepository {
	search(input: ArchiveSearchInput): Promise<SearchResult[]>;
}
