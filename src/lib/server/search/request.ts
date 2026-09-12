import { z } from 'zod';
import { archiveSearchInputSchema, searchModeSchema, type ArchiveSearchInput } from './contracts';

const DATE_END_TIME = 'T23:59:59.999Z';
const DATE_START_TIME = 'T00:00:00.000Z';
const SERVER_RESULT_LIMIT = 24;

const searchRequestSchema = z
	.object({
		mode: searchModeSchema,
		query: z.string().trim().max(400),
		channelSlugs: z.array(z.string().trim().min(1)).max(20),
		blockTypes: z.array(z.string().trim().min(1)).max(20),
		from: z.iso.date().optional(),
		to: z.iso.date().optional()
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

export function parseArchiveSearchRequest(searchParams: URLSearchParams): ArchiveSearchInput {
	const query = singleParam(searchParams, 'q') ?? '';
	const explicitMode = singleParam(searchParams, 'mode');
	const raw = {
		mode: explicitMode ?? (query.trim() ? 'hybrid' : 'browse'),
		query,
		channelSlugs: searchParams.getAll('channel'),
		blockTypes: searchParams.getAll('type'),
		from: singleParam(searchParams, 'from'),
		to: singleParam(searchParams, 'to')
	};
	const parsed = searchRequestSchema.safeParse(raw);
	if (!parsed.success) throw new SearchRequestValidationError(parsed.error);

	return archiveSearchInputSchema.parse({
		...parsed.data,
		from: parsed.data.from ? new Date(`${parsed.data.from}${DATE_START_TIME}`) : undefined,
		to: parsed.data.to ? new Date(`${parsed.data.to}${DATE_END_TIME}`) : undefined,
		limit: SERVER_RESULT_LIMIT
	});
}
