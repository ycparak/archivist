import { describe, expect, it } from 'vitest';
import {
	matchesEvaluationCase,
	searchEvaluationCaseSchema,
	type SearchEvaluationCase
} from './evaluation';

const noResultCase: SearchEvaluationCase = {
	id: 'no-result',
	mode: 'browse',
	channel: ['no-such-public-archive-channel'],
	expectedBlockIds: []
};

describe('matchesEvaluationCase', () => {
	it('requires a no-result expectation to return no records', () => {
		expect(matchesEvaluationCase(noResultCase, new Set())).toBe(true);
		expect(matchesEvaluationCase(noResultCase, new Set(['block:1']))).toBe(false);
	});
});

it('retains colour, created date and browse sort evaluation inputs', () => {
	const fields = {
		colour: ['blue', 'orange'],
		created_from: '2026-09-01',
		created_to: '2026-09-30',
		sort: 'oldest-created'
	};
	expect(searchEvaluationCaseSchema.parse({ ...noResultCase, ...fields })).toMatchObject(fields);
});
