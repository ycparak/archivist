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

export const GATE_POLICIES = ['strict', 'no-regression'] as const;
type GatePolicy = (typeof GATE_POLICIES)[number];

/**
 * `strict` requires every non-pending case on the first page. `no-regression` also accepts a case
 * that already misses the first page on the baseline, as a reported known failure, provided its
 * expected ranks drop by at most `maxRankDrop`; a case the baseline passes must still pass.
 */
export function evaluateRelease(
	candidate: ValidatedRelease,
	cases: SearchEvaluationCase[],
	queries: Record<string, number[]>,
	baseline?: ValidatedRelease,
	maxRankDrop: number | null = null,
	gate: GatePolicy = 'strict'
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
		const baselineFirstPagePass = previous
			? ranks.length
				? ranks.every(
						({ baselineRank }) => baselineRank !== null && baselineRank <= ARCHIVE_RESULT_LIMIT
					)
				: previous.length === 0
			: null;
		const knownFailure =
			gate === 'no-regression' && baselineFirstPagePass === false && !firstPagePass;
		const dropped = (limit: number) =>
			ranks.some(
				({ rank, baselineRank }) =>
					baselineRank !== null && (rank === null || rank - baselineRank > limit)
			);
		const regression = knownFailure
			? dropped(maxRankDrop ?? 0)
			: gate === 'strict' && maxRankDrop !== null && dropped(maxRankDrop);
		return {
			id: testCase.id,
			pending: testCase.pending ?? null,
			resultCount: ranked.length,
			ranks,
			firstPagePass,
			knownFailure,
			regression,
			passed:
				Boolean(testCase.pending) || (knownFailure ? !regression : firstPagePass && !regression),
			nodeSearchMs: elapsedMs
		};
	});
}

export function evaluationEvidence(results: ReturnType<typeof evaluateRelease>) {
	return results.map(
		({ id, pending, resultCount, ranks, firstPagePass, knownFailure, regression, passed }) => ({
			id,
			pending,
			resultCount,
			ranks,
			firstPagePass,
			knownFailure,
			regression,
			passed
		})
	);
}
