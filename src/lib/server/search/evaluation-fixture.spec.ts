import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { searchEvaluationCasesSchema } from '$lib/server/search/evaluation';

describe('search evaluation fixture', () => {
	it('covers every V1 retrieval scenario with cases that gate the run', async () => {
		const fixture = JSON.parse(
			await readFile(
				new URL('../../../../scripts/fixtures/search-cases.json', import.meta.url),
				'utf8'
			)
		);
		const cases = searchEvaluationCasesSchema.parse(fixture);
		const gating = cases.filter((testCase) => !testCase.pending);

		expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(cases.length);
		expect(gating.some((testCase) => testCase.mode === 'lexical')).toBe(true);
		expect(gating.some((testCase) => testCase.mode === 'semantic')).toBe(true);
		expect(gating.some((testCase) => testCase.channel?.length)).toBe(true);
		expect(gating.some((testCase) => testCase.type?.length)).toBe(true);
		expect(gating.some((testCase) => testCase.expectedBlockIds.length === 0)).toBe(true);
	});

	it('gives every pending case a target to reach rather than an open-ended exemption', async () => {
		const fixture = JSON.parse(
			await readFile(
				new URL('../../../../scripts/fixtures/search-cases.json', import.meta.url),
				'utf8'
			)
		);
		const pending = searchEvaluationCasesSchema
			.parse(fixture)
			.filter((testCase) => testCase.pending);

		// Asserted over the whole set rather than per case, so this still holds — and still runs —
		// when nothing is pending.
		expect(pending.filter((testCase) => testCase.expectedBlockIds.length === 0)).toEqual([]);
	});
});
