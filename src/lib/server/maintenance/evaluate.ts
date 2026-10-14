import { z } from 'zod';
import { ARCHIVE_RESULT_LIMIT, ARCHIVE_SEARCH_PARAM } from '$lib/domain/search';
import { EMBEDDING, embeddingVectorSchema, normalizeVector } from '$lib/search/embedding';
import { parseArchiveSearchRequest } from '$lib/search/request';
import {
	searchEvaluationCaseSchema,
	type SearchEvaluationCase
} from '$lib/server/search/evaluation';
import type { ValidatedRelease } from './release';

export const evaluationCasesSchema = z
	.array(searchEvaluationCaseSchema)
	.min(1)
	.refine(
		(cases) => new Set(cases.map(({ id }) => id)).size === cases.length,
		'Duplicate evaluation case IDs'
	);
export const queryVectorsSchema = z.record(z.string(), embeddingVectorSchema);

export function evaluationRequest(testCase: SearchEvaluationCase) {
	const params = new URLSearchParams({ [ARCHIVE_SEARCH_PARAM.mode]: testCase.mode });
	for (const [value, key] of [
		[testCase.q, ARCHIVE_SEARCH_PARAM.query],
		[testCase.from, ARCHIVE_SEARCH_PARAM.from],
		[testCase.to, ARCHIVE_SEARCH_PARAM.to],
		[testCase.created_from, ARCHIVE_SEARCH_PARAM.createdFrom],
		[testCase.created_to, ARCHIVE_SEARCH_PARAM.createdTo],
		[testCase.sort, ARCHIVE_SEARCH_PARAM.sort]
	] as const)
		if (value) params.set(key, value);
	for (const [values, key] of [
		[testCase.channel, ARCHIVE_SEARCH_PARAM.channel],
		[testCase.type, ARCHIVE_SEARCH_PARAM.type],
		[testCase.colour, ARCHIVE_SEARCH_PARAM.colour]
	] as const)
		for (const value of values ?? []) params.append(key, value);
	return parseArchiveSearchRequest(params);
}

export async function embedEvaluationQueries(
	cases: SearchEvaluationCase[],
	embed: (texts: string[]) => Promise<number[][]>
) {
	const texts = [
		...new Set(
			cases
				.map(evaluationRequest)
				.filter(({ mode }) => mode === 'hybrid' || mode === 'semantic')
				.map(({ query }) => EMBEDDING.queryPrefix + query)
		)
	];
	const queries: Record<string, number[]> = {};
	for (let offset = 0; offset < texts.length; offset += 32) {
		const batch = texts.slice(offset, offset + 32);
		const vectors = await embed(batch);
		if (vectors.length !== batch.length) throw new Error('Query embedding count mismatch');
		for (const [i, text] of batch.entries()) queries[text] = normalizeVector(vectors[i]);
	}
	return queries;
}

export function evaluateRelease(
	candidate: ValidatedRelease,
	cases: SearchEvaluationCase[],
	queries: Record<string, number[]>,
	baseline?: ValidatedRelease,
	maxRankDrop: number | null = null
) {
	return cases.map((testCase) => {
		const input = evaluationRequest(testCase);
		const needsVector = input.mode === 'hybrid' || input.mode === 'semantic';
		const vector = needsVector ? queries[EMBEDDING.queryPrefix + input.query] : undefined;
		if (needsVector && !vector) throw new Error('Missing evaluation query vector');
		const started = performance.now();
		const ranked = candidate.engine.search(input, vector).map(({ id }) => id);
		const elapsedMs = performance.now() - started;
		const previous = baseline?.engine.search(input, vector).map(({ id }) => id);
		const ranks = testCase.expectedBlockIds.map((id) => {
			const rank = ranked.indexOf(id) < 0 ? null : ranked.indexOf(id) + 1;
			const baselineRank = previous && previous.indexOf(id) >= 0 ? previous.indexOf(id) + 1 : null;
			return {
				id,
				rank,
				baselineRank,
				drop: rank !== null && baselineRank !== null ? rank - baselineRank : null
			};
		});
		const firstPagePass = ranks.length
			? ranks.every(({ rank }) => rank !== null && rank <= ARCHIVE_RESULT_LIMIT)
			: ranked.length === 0;
		const regression =
			maxRankDrop !== null &&
			ranks.some(
				({ rank, baselineRank }) =>
					baselineRank !== null && (rank === null || rank - baselineRank > maxRankDrop)
			);
		return {
			id: testCase.id,
			pending: testCase.pending ?? null,
			resultCount: ranked.length,
			ranks,
			firstPagePass,
			regression,
			passed: Boolean(testCase.pending) || (firstPagePass && !regression),
			nodeSearchMs: elapsedMs
		};
	});
}

export function evaluationEvidence(results: ReturnType<typeof evaluateRelease>) {
	return results.map(({ id, pending, resultCount, ranks, firstPagePass, regression, passed }) => ({
		id,
		pending,
		resultCount,
		ranks,
		firstPagePass,
		regression,
		passed
	}));
}

export function formatEvaluationResult(result: ReturnType<typeof evaluateRelease>[number]): string {
	const status = result.pending
		? result.firstPagePass
			? 'PENDING CASE NOW PASSES — remove its pending field'
			: 'pending'
		: result.passed
			? 'passed'
			: 'FAILED';
	return `${result.id}: ${status} (${result.ranks.map(({ id, rank }) => `${id}@${rank ?? 'missing'}`).join(', ')} of ${result.resultCount})`;
}
