import { z } from 'zod';
import { ARCHIVE_BLOCK_TYPES } from '$lib/domain/search';
import { searchModeSchema } from './contracts';

export const searchEvaluationCaseSchema = z.object({
	id: z.string().min(1),
	mode: searchModeSchema,
	q: z.string().min(1).optional(),
	channel: z.array(z.string().min(1)).min(1).optional(),
	type: z.array(z.enum(ARCHIVE_BLOCK_TYPES)).min(1).optional(),
	from: z.iso.date().optional(),
	to: z.iso.date().optional(),
	expectedBlockIds: z.array(z.string())
});

export const searchEvaluationCasesSchema = z.array(searchEvaluationCaseSchema).min(10);

export type SearchEvaluationCase = z.infer<typeof searchEvaluationCaseSchema>;

export function matchesEvaluationCase(
	testCase: SearchEvaluationCase,
	resultIds: Set<string>
): boolean {
	return testCase.expectedBlockIds.length
		? testCase.expectedBlockIds.every((id) => resultIds.has(id))
		: resultIds.size === 0;
}
