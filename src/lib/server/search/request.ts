import { z } from 'zod';
import {
	ARCHIVE_BLOCK_TYPES,
	ARCHIVE_COLOURS,
	ARCHIVE_MAX_COLOURS,
	ARCHIVE_MAX_OFFSET,
	ARCHIVE_PAGE_PARAM,
	ARCHIVE_RESULT_LIMIT,
	ARCHIVE_SEARCH_PARAM,
	defaultSearchMode
} from '$lib/domain/search';
import { archiveSearchInputSchema, searchModeSchema, type ArchiveSearchInput } from './contracts';

const DATE_END_TIME = 'T23:59:59.999Z';
const DATE_START_TIME = 'T00:00:00.000Z';

const searchRequestSchema = z
	.object({
		mode: searchModeSchema,
		query: z.string().trim().max(400),
		channelSlugs: z.array(z.string().trim().min(1)).max(20),
		blockTypes: z.array(z.enum(ARCHIVE_BLOCK_TYPES)).max(20),
		colours: z.array(z.enum(ARCHIVE_COLOURS)).max(ARCHIVE_MAX_COLOURS),
		from: z.iso.date().optional(),
		to: z.iso.date().optional(),
		offset: z
			.string()
			.regex(/^\d+$/)
			.refine((value) => Number(value) <= ARCHIVE_MAX_OFFSET)
			.optional()
	})
	.superRefine((input, context) => {
		if (input.mode !== 'browse' && !input.query) {
			context.addIssue({
				code: 'custom',
				path: ['query'],
				message: 'q is required unless mode is browse'
			});
		}
		if (input.from && input.to && input.from > input.to) {
			context.addIssue({
				code: 'custom',
				path: ['to'],
				message: 'to must not be before from'
			});
		}
	});

export class SearchRequestValidationError extends Error {
	constructor(readonly cause: z.ZodError) {
		super('Invalid search request');
		this.name = 'SearchRequestValidationError';
	}
}

function singleParam(searchParams: URLSearchParams, name: string): string | undefined {
	const values = searchParams.getAll(name);
	if (values.length > 1) {
		throw new SearchRequestValidationError(
			new z.ZodError([
				{ code: 'custom', path: [name], message: `${name} may only be specified once` }
			])
		);
	}
	return values[0];
}

function optionalParam(searchParams: URLSearchParams, name: string): string | undefined {
	const value = singleParam(searchParams, name);
	return value?.trim() ? value : undefined;
}

function repeatedParams(searchParams: URLSearchParams, name: string): string[] {
	return searchParams
		.getAll(name)
		.map((value) => value.trim())
		.filter(Boolean);
}

export function parseArchiveSearchRequest(searchParams: URLSearchParams): ArchiveSearchInput {
	const query = singleParam(searchParams, ARCHIVE_SEARCH_PARAM.query) ?? '';
	const explicitMode = optionalParam(searchParams, ARCHIVE_SEARCH_PARAM.mode);
	const raw = {
		mode: explicitMode ?? defaultSearchMode(query),
		query,
		channelSlugs: repeatedParams(searchParams, ARCHIVE_SEARCH_PARAM.channel),
		blockTypes: repeatedParams(searchParams, ARCHIVE_SEARCH_PARAM.type),
		// Each colour becomes a sort key, and a repeated key is not a different order.
		colours: [...new Set(repeatedParams(searchParams, ARCHIVE_SEARCH_PARAM.colour))],
		from: optionalParam(searchParams, ARCHIVE_SEARCH_PARAM.from),
		to: optionalParam(searchParams, ARCHIVE_SEARCH_PARAM.to),
		offset: optionalParam(searchParams, ARCHIVE_PAGE_PARAM.offset)
	};
	const parsed = searchRequestSchema.safeParse(raw);
	if (!parsed.success) throw new SearchRequestValidationError(parsed.error);

	return archiveSearchInputSchema.parse({
		...parsed.data,
		from: parsed.data.from ? new Date(`${parsed.data.from}${DATE_START_TIME}`) : undefined,
		to: parsed.data.to ? new Date(`${parsed.data.to}${DATE_END_TIME}`) : undefined,
		offset: parsed.data.offset ? Number(parsed.data.offset) : 0,
		limit: ARCHIVE_RESULT_LIMIT
	});
}
