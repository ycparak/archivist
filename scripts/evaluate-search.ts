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

/** Where each expected block landed, so a change that keeps a case passing but sinks it is visible. */
function formatRanks(expectedBlockIds: string[], orderedIds: string[]): string {
	if (!expectedBlockIds.length) return '';
	const ranks = expectedBlockIds.map((id) => {
		const index = orderedIds.indexOf(id);
		return `${id}@${index === -1 ? '—' : index + 1}`;
	});
	return ` (${ranks.join(', ')} of ${orderedIds.length})`;
}

let failures = 0;
let readyToPromote = 0;
for (const testCase of cases) {
	const { results } = await repository.search(parseArchiveSearchRequest(toSearchParams(testCase)));
	const orderedIds = results.map((result) => result.id);
	const resultIds = new Set(orderedIds);
	const missing = testCase.expectedBlockIds.filter((id) => !resultIds.has(id));
	const ranks = formatRanks(testCase.expectedBlockIds, orderedIds);

	if (matchesEvaluationCase(testCase, resultIds)) {
		if (testCase.pending) {
			readyToPromote += 1;
			console.log(`${testCase.id}: PENDING CASE NOW PASSES${ranks} — remove its "pending" field`);
		} else {
			console.log(`${testCase.id}: passed${ranks}`);
		}
		continue;
	}

	const detail = missing.length
		? `missing expected public block IDs: ${missing.join(', ')}`
		: `expected no results, received ${results.length}`;

	if (testCase.pending) {
		console.log(`${testCase.id}: pending — ${detail} (${testCase.pending})`);
		continue;
	}

	failures += 1;
	console.error(`${testCase.id}: ${detail}${ranks}`);
}

if (readyToPromote) {
	console.log(
		`\n${readyToPromote} pending case(s) now pass and should lose their "pending" field.`
	);
}

if (failures) process.exit(1);
