import { expect, it } from 'vitest';
import { searchEvaluationCaseSchema, type SearchEvaluationCase } from './evaluation';

const noResultCase: SearchEvaluationCase = {
	id: 'no-result',
	mode: 'browse',
	channel: ['no-such-public-archive-channel'],
	expectedBlockIds: []
};

it('retains colour, created date and browse sort evaluation inputs', () => {
	const fields = {
		colour: ['blue', 'orange'],
		created_from: '2026-09-01',
		created_to: '2026-09-30',
		sort: 'oldest-created'
	};
	expect(searchEvaluationCaseSchema.parse({ ...noResultCase, ...fields })).toMatchObject(fields);
});
