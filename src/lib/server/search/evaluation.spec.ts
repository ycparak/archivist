import { describe, expect, it } from 'vitest';
import { matchesEvaluationCase, type SearchEvaluationCase } from './evaluation';

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
