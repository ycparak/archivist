import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { searchEvaluationCasesSchema } from '$lib/server/search/evaluation';

describe('search evaluation fixture', () => {
	it('contains ten public query expectations covering V1 retrieval scenarios', async () => {
		const fixture = JSON.parse(
			await readFile(
				new URL('../../../../scripts/fixtures/search-cases.json', import.meta.url),
				'utf8'
			)
		);
		const cases = searchEvaluationCasesSchema.parse(fixture);

		expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(cases.length);
		expect(cases.some((testCase) => testCase.mode === 'lexical')).toBe(true);
		expect(cases.some((testCase) => testCase.mode === 'semantic')).toBe(true);
		expect(cases.some((testCase) => testCase.channel?.length)).toBe(true);
		expect(cases.some((testCase) => testCase.type?.length)).toBe(true);
		expect(cases.some((testCase) => testCase.expectedBlockIds.length === 0)).toBe(true);
	});
});
