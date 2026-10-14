import { expect, it } from 'vitest';
import MiniSearch from 'minisearch';
import { lexicalOptions } from '$lib/search/core';
import { validateLexical } from './lexical';

it('validates real serialization and rejects malformed scoring data and postings', () => {
	const index = new MiniSearch(lexicalOptions);
	index.addAll([
		{ id: 'block:1', search_text: 'Blue blue fox fox' },
		{ id: 'block:2', search_text: 'green fox' }
	]);
	const raw = index.toJSON();
	expect(validateLexical(raw).documentCount).toBe(2);
	expect(() => validateLexical({ ...raw, averageFieldLength: ['invalid'] })).toThrow();
	expect(() => validateLexical({ ...raw, averageFieldLength: [100] })).toThrow('average');
	expect(() => validateLexical({ ...raw, index: [['fox', { '0': { '999': 1 } }]] })).toThrow(
		'unknown'
	);
});
