import { readFile } from 'node:fs/promises';
import { ARCHIVE_SEARCH_PARAM } from '$lib/domain/search';
import { DEFAULT_NAMESPACE } from '$lib/server/search/namespace';
import { parseArchiveSearchRequest } from '$lib/server/search/request';
import {
	matchesEvaluationCase,
	searchEvaluationCasesSchema,
	type SearchEvaluationCase
} from '$lib/server/search/evaluation';
import { TurbopufferSearchRepository } from '$lib/server/search/repository';

const apiKey = process.env.TURBOPUFFER_API_KEY;
const region = process.env.TURBOPUFFER_REGION;

if (!apiKey || !region) {
	console.error('TURBOPUFFER_API_KEY and TURBOPUFFER_REGION must both be set.');
	process.exit(1);
}

function toSearchParams(testCase: SearchEvaluationCase): URLSearchParams {
	const params = new URLSearchParams({ [ARCHIVE_SEARCH_PARAM.mode]: testCase.mode });
	if (testCase.q) params.set(ARCHIVE_SEARCH_PARAM.query, testCase.q);
	for (const channel of testCase.channel ?? []) {
		params.append(ARCHIVE_SEARCH_PARAM.channel, channel);
	}
	for (const type of testCase.type ?? []) params.append(ARCHIVE_SEARCH_PARAM.type, type);
	if (testCase.from) params.set(ARCHIVE_SEARCH_PARAM.from, testCase.from);
	if (testCase.to) params.set(ARCHIVE_SEARCH_PARAM.to, testCase.to);
	return params;
}

const fixture = JSON.parse(
	await readFile(new URL('./fixtures/search-cases.json', import.meta.url), 'utf8')
);
const cases = searchEvaluationCasesSchema.parse(fixture);
const repository = new TurbopufferSearchRepository({
	apiKey,
	region,
	namespace: process.env.TURBOPUFFER_NAMESPACE || DEFAULT_NAMESPACE
});

let failures = 0;
for (const testCase of cases) {
	const { results } = await repository.search(parseArchiveSearchRequest(toSearchParams(testCase)));
	const resultIds = new Set(results.map((result) => result.id));
	const missing = testCase.expectedBlockIds.filter((id) => !resultIds.has(id));
	if (!matchesEvaluationCase(testCase, resultIds)) {
		failures += 1;
		if (missing.length) {
			console.error(`${testCase.id}: missing expected public block IDs: ${missing.join(', ')}`);
		} else {
			console.error(`${testCase.id}: expected no results, received ${results.length}`);
		}
	} else {
		console.log(`${testCase.id}: passed`);
	}
}

if (failures) process.exit(1);
