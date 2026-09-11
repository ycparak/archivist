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
	sourceTitle: string | null;
};

export interface SearchRepository {
	search(input: ArchiveSearchInput): Promise<SearchResult[]>;
}
