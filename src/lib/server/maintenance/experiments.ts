import MiniSearch from 'minisearch';
import { z } from 'zod';
import type { SearchDocument } from '$lib/domain/archive';
import { ARCHIVE_RESULT_LIMIT } from '$lib/domain/search';
import { lowQualityTitleReason } from '$lib/domain/titles';
import {
	compareBrowse,
	lexicalOptions,
	matchesFilters,
	PRODUCTION_RANKING,
	type RankingOptions
} from '$lib/search/core';
import { EMBEDDING, normalizeVector } from '$lib/search/embedding';
import type { SearchEvaluationCase } from '$lib/server/search/evaluation';
import { EMBEDDING_CHUNK_BYTES, embeddingChunks } from '$lib/server/search/export';
import { buildSearchRelease, sha256 } from '$lib/server/search/release-builder';
import type { ChannelManifestEntry } from '$lib/domain/search';
import { evaluateRelease, evaluationRequest } from './evaluate';
import { jobIdSchema } from './hosted-release';
import { loadValidatedRelease, releaseAssets, type ValidatedRelease } from './release';
import type { ObjectStore } from './store';

const changeSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('rrf-k'), value: z.number().int().min(1).max(1_000) }).strict(),
	z.object({ kind: z.literal('lexical-prefix'), value: z.boolean() }).strict(),
	z.object({ kind: z.literal('lexical-fuzzy'), value: z.number().min(0).max(0.4) }).strict(),
	// The embedding model reads at most 512 tokens and WordPiece never emits more tokens than bytes.
	z.object({ kind: z.literal('chunk-bytes'), value: z.number().int().min(128).max(500) }).strict()
]);
type ExperimentChange = z.infer<typeof changeSchema>;

/** Each variant changes exactly one thing against the production control. */
export const experimentSpecSchema = z
	.object({
		format: z.literal(1),
		name: z.string().min(1).max(80),
		discoveryJobId: jobIdSchema,
		heldOut: z.object({ count: z.number().int().min(0).max(500), seed: z.number().int() }).strict(),
		variants: z
			.array(
				z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), change: changeSchema }).strict()
			)
			.min(1)
			.max(8)
	})
	.strict()
	.refine(
		({ variants }) => new Set(variants.map(({ name }) => name)).size === variants.length,
		'Variant names must be unique'
	);

/** Refuses every write, so an experiment cannot alter production state even by mistake. */
export function readOnlyStore(store: ObjectStore): ObjectStore {
	const refuse = async () => {
		throw new Error('Experiments are read-only against hosted storage');
	};
	return {
		get: (key) => store.get(key),
		list: (prefix) => store.list(prefix),
		put: refuse,
		delete: refuse
	};
}

function mulberry32(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/**
 * Known-item queries drawn from informative, unique block titles, reproducible from a seed. They
 * guard against tuning only for the hand-written fixture; they are not a relevance judgement.
 */
export function heldOutCases(
	documents: readonly SearchDocument[],
	options: { count: number; seed: number }
): SearchEvaluationCase[] {
	const titles = new Map<string, number>();
	for (const { title } of documents) {
		const key = title?.trim().toLowerCase();
		if (key) titles.set(key, (titles.get(key) ?? 0) + 1);
	}
	const pool = documents
		.filter(({ title, description }) => {
			const text = title?.trim();
			return (
				text &&
				text.split(/\s+/).length >= 3 &&
				titles.get(text.toLowerCase()) === 1 &&
				!lowQualityTitleReason(text, description)
			);
		})
		.sort((a, b) => a.id.localeCompare(b.id));
	const random = mulberry32(options.seed);
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return pool.slice(0, options.count).map((document, index) => ({
		id: `heldout-${index + 1}`,
		mode: 'hybrid',
		q: document.title!.trim().slice(0, 200),
		expectedBlockIds: [document.id]
	}));
}

interface CaseScore {
	reciprocal: number;
	recall: number;
	firstPage: boolean;
	top: boolean;
}

function scoreCases(results: ReturnType<typeof evaluateRelease>): CaseScore[] {
	return results
		.filter(({ ranks }) => ranks.length)
		.map(({ ranks }) => ({
			reciprocal: ranks.reduce((sum, { rank }) => sum + (rank ? 1 / rank : 0), 0) / ranks.length,
			recall:
				ranks.filter(({ rank }) => rank !== null && rank <= ARCHIVE_RESULT_LIMIT).length /
				ranks.length,
			firstPage: ranks.every(({ rank }) => rank !== null && rank <= ARCHIVE_RESULT_LIMIT),
			top: ranks.some(({ rank }) => rank === 1)
		}));
}

const mean = (values: number[]) =>
	values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/** Filters, uniqueness, exact browse order and determinism must hold for every variant. */
function checkInvariants(
	release: ValidatedRelease,
	cases: SearchEvaluationCase[],
	queries: Record<string, number[]>
): string[] {
	const byId = new Map(release.metadata.documents.map((d) => [d.result.id, d]));
	const violations: string[] = [];
	for (const testCase of cases) {
		const input = evaluationRequest(testCase);
		const vector =
			input.mode === 'hybrid' || input.mode === 'semantic'
				? queries[EMBEDDING.queryPrefix + input.query]
				: undefined;
		const first = release.engine.search(input, vector).map(({ id }) => id);
		const again = release.engine.search(input, vector).map(({ id }) => id);
		if (first.join() !== again.join())
			violations.push(`${testCase.id}: ranking is not deterministic`);
		if (new Set(first).size !== first.length) violations.push(`${testCase.id}: duplicate results`);
		if (first.some((id) => !matchesFilters(byId.get(id)!, input)))
			violations.push(`${testCase.id}: a result violates the filters`);
		if (input.mode === 'browse') {
			const expected = [...byId.values()]
				.filter((d) => matchesFilters(d, input))
				.sort((a, b) => compareBrowse(a, b, input))
				.map((d) => d.result.id);
			if (first.join() !== expected.join()) violations.push(`${testCase.id}: browse order changed`);
		}
	}
	return violations;
}

export interface ExperimentDependencies {
	documents: SearchDocument[];
	channels: ChannelManifestEntry[];
	fixture: SearchEvaluationCase[];
	/** Persisted embeddings to reuse; new ones are added to it and saved locally. */
	embeddings: Map<string, number[]>;
	saveEmbeddings: (cache: Map<string, number[]>) => Promise<void>;
	/** Persisted query vectors, so a rerun of the same spec scores against identical queries. */
	queryVectors: Record<string, number[]>;
	saveQueryVectors: (vectors: Record<string, number[]>) => Promise<void>;
	embed: (texts: string[]) => Promise<number[][]>;
	gzipSize: (bytes: Uint8Array) => Promise<number>;
	pins: Record<string, string>;
}

async function variantMetrics(
	release: ValidatedRelease,
	fixture: SearchEvaluationCase[],
	heldOut: SearchEvaluationCase[],
	queries: Record<string, number[]>,
	gzipSize: (bytes: Uint8Array) => Promise<number>
) {
	const fixtureResults = evaluateRelease(release, fixture, queries);
	const heldOutResults = evaluateRelease(release, heldOut, queries);
	const fixtureScores = scoreCases(fixtureResults);
	const heldOutScores = scoreCases(heldOutResults);
	let gzipBytes = 0;
	for (const asset of releaseAssets(release.release))
		gzipBytes += await gzipSize(release.assets.get(asset.file)!);
	return {
		fixture: {
			firstPagePasses: fixtureResults.filter(
				({ pending, firstPagePass }) => !pending && firstPagePass
			).length,
			cases: fixtureResults.filter(({ pending }) => !pending).length,
			meanReciprocalRank: mean(fixtureScores.map(({ reciprocal }) => reciprocal)),
			recallAtFirstPage: mean(fixtureScores.map(({ recall }) => recall)),
			ranks: Object.fromEntries(
				fixtureResults.map(({ id, ranks }) => [id, ranks.map(({ rank }) => rank)])
			)
		},
		heldOut: {
			cases: heldOut.length,
			meanReciprocalRank: mean(heldOutScores.map(({ reciprocal }) => reciprocal)),
			successAt1: mean(heldOutScores.map(({ top }) => (top ? 1 : 0))),
			recallAtFirstPage: mean(heldOutScores.map(({ recall }) => recall))
		},
		invariantViolations: checkInvariants(release, [...fixture, ...heldOut], queries),
		vectors: release.release.vectorCount,
		rawBytes: releaseAssets(release.release).reduce((sum, { bytes }) => sum + bytes, 0),
		gzipBytes,
		nodeSearchMs: Number(
			[...fixtureResults, ...heldOutResults].reduce((sum, r) => sum + r.nodeSearchMs, 0).toFixed(2)
		)
	};
}
type VariantMetrics = Awaited<ReturnType<typeof variantMetrics>>;

/**
 * Builds the production control and each single-change variant from one pinned corpus, scores them
 * on the fixture and a held-out set, and suggests — never promotes — a winner.
 */
export async function runExperiment(rawSpec: unknown, deps: ExperimentDependencies) {
	const spec = experimentSpecSchema.parse(rawSpec);
	let embeddingRequests = 0;
	let embeddedTexts = 0;
	const embed = async (texts: string[]) => {
		embeddingRequests += 1;
		embeddedTexts += texts.length;
		return deps.embed(texts);
	};
	const build = async (chunkBytes: number) => {
		const before = { embeddingRequests, embeddedTexts };
		const built = await buildSearchRelease(
			deps.documents,
			deps.channels,
			embed,
			deps.embeddings,
			deps.saveEmbeddings,
			{ chunkBytes }
		);
		const read = async (asset: { file: string }) => built.assets.get(asset.file)!;
		return {
			built,
			read,
			cost: {
				embeddingRequests: embeddingRequests - before.embeddingRequests,
				embeddedTexts: embeddedTexts - before.embeddedTexts
			}
		};
	};

	const control = await build(EMBEDDING_CHUNK_BYTES);
	const controlRelease = await loadValidatedRelease(control.built.release, control.read);
	const heldOut = heldOutCases(deps.documents, spec.heldOut);
	const cases = [...deps.fixture, ...heldOut];
	const queries = { ...deps.queryVectors };
	const missing = [
		...new Set(
			cases
				.map(evaluationRequest)
				.filter(({ mode }) => mode === 'hybrid' || mode === 'semantic')
				.map(({ query }) => EMBEDDING.queryPrefix + query)
		)
	].filter((text) => !queries[text]);
	for (let offset = 0; offset < missing.length; offset += 32) {
		const batch = missing.slice(offset, offset + 32);
		const vectors = await embed(batch);
		for (const [i, text] of batch.entries()) queries[text] = normalizeVector(vectors[i]);
	}
	if (missing.length) await deps.saveQueryVectors(queries);

	const controlMetrics = await variantMetrics(
		controlRelease,
		deps.fixture,
		heldOut,
		queries,
		deps.gzipSize
	);
	const variants: {
		name: string;
		change: ExperimentChange;
		ranking: RankingOptions;
		chunkBytes: number;
		cost: typeof control.cost;
		metrics: VariantMetrics;
	}[] = [];
	for (const variant of spec.variants) {
		const { change } = variant;
		const ranking: RankingOptions = {
			...PRODUCTION_RANKING,
			...(change.kind === 'rrf-k' ? { rrfK: change.value } : {}),
			...(change.kind === 'lexical-prefix' ? { prefix: change.value } : {}),
			...(change.kind === 'lexical-fuzzy' ? { fuzzy: change.value } : {})
		};
		const chunkBytes = change.kind === 'chunk-bytes' ? change.value : EMBEDDING_CHUNK_BYTES;
		const source =
			chunkBytes === EMBEDDING_CHUNK_BYTES
				? { ...control, cost: { embeddingRequests: 0, embeddedTexts: 0 } }
				: await build(chunkBytes);
		const release = await loadValidatedRelease(source.built.release, source.read, ranking);
		variants.push({
			name: variant.name,
			change,
			ranking,
			chunkBytes,
			cost: source.cost,
			metrics: await variantMetrics(release, deps.fixture, heldOut, queries, deps.gzipSize)
		});
	}

	// A suggestion must not lose a fixture case, must keep every invariant, and must beat the control.
	const key = (m: VariantMetrics) => [
		m.fixture.firstPagePasses,
		m.heldOut.meanReciprocalRank,
		m.fixture.meanReciprocalRank
	];
	const better = (a: VariantMetrics, b: VariantMetrics) => {
		const [x, y] = [key(a), key(b)];
		for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > 1e-9) return x[i] > y[i];
		return false;
	};
	const eligible = variants.filter(
		({ metrics }) =>
			!metrics.invariantViolations.length &&
			Object.entries(controlMetrics.fixture.ranks).every(([id, ranks]) => {
				const passedBefore =
					ranks.length && ranks.every((r) => r !== null && r <= ARCHIVE_RESULT_LIMIT);
				const after = metrics.fixture.ranks[id];
				return !passedBefore || after.every((r) => r !== null && r <= ARCHIVE_RESULT_LIMIT);
			}) &&
			better(metrics, controlMetrics)
	);
	const suggestion = eligible.reduce<(typeof variants)[number] | null>(
		(best, v) => (!best || better(v.metrics, best.metrics) ? v : best),
		null
	);
	return {
		format: 1 as const,
		spec,
		specHash: await sha256(new TextEncoder().encode(JSON.stringify(spec))),
		pins: deps.pins,
		heldOutQueries: heldOut.map(({ id, q, expectedBlockIds }) => ({
			id,
			q,
			expected: expectedBlockIds[0]
		})),
		control: {
			ranking: PRODUCTION_RANKING,
			chunkBytes: EMBEDDING_CHUNK_BYTES,
			cost: control.cost,
			metrics: controlMetrics
		},
		variants,
		suggestion: suggestion
			? {
					variant: suggestion.name,
					note: 'Suggestion only. Adopting it needs a reviewed change, versioning where required, and ordinary candidate validation.'
				}
			: null,
		totals: { embeddingRequests, embeddedTexts },
		mobile: 'unverified' as const
	};
}
type ExperimentReport = Awaited<ReturnType<typeof runExperiment>>;

/**
 * Evidence for one fixture case before anyone proposes a ranking change: where the expected block
 * sits in each list, which terms matched, and how its best chunk compares with the leaders'.
 */
export async function investigateCase(options: {
	release: ValidatedRelease;
	documents: SearchDocument[];
	embeddings: Map<string, number[]>;
	testCase: SearchEvaluationCase;
	queryVector?: number[];
	top?: number;
}) {
	const { release, testCase, queryVector, top = 5 } = options;
	const input = evaluationRequest(testCase);
	const vector = queryVector && normalizeVector(queryVector);
	const ranks = (mode: 'lexical' | 'semantic' | 'hybrid') => {
		if (mode !== 'lexical' && !vector) return [];
		return release.engine.search({ ...input, mode }, vector).map(({ id }) => id);
	};
	const lists = { lexical: ranks('lexical'), semantic: ranks('semantic'), hybrid: ranks('hybrid') };
	const position = (list: string[], id: string) =>
		list.indexOf(id) < 0 ? null : list.indexOf(id) + 1;
	const lexical = MiniSearch.loadJSON(
		new TextDecoder().decode(release.assets.get(release.release.lexical.file)!),
		lexicalOptions
	);
	const matches = new Map(
		lexical
			.search(input.query, { combineWith: 'OR' })
			.map((hit) => [String(hit.id), { score: hit.score, terms: hit.terms }])
	);
	const sources = new Map(options.documents.map((d) => [d.id, d]));
	const encoder = new TextEncoder();
	const chunkEvidence = async (id: string) => {
		const document = sources.get(id);
		if (!document || !vector) return null;
		const scored: { similarity: number | null; excerpt: string }[] = [];
		for (const chunk of embeddingChunks(document.search_text)) {
			// The same content key the release builder uses for its embedding cache.
			const key = await sha256(encoder.encode(`${EMBEDDING.version}\n${chunk}`));
			const embedding = options.embeddings.get(key);
			scored.push({
				similarity: embedding
					? embedding.reduce((sum, value, i) => sum + value * vector[i], 0)
					: null,
				excerpt: chunk.slice(0, 160)
			});
		}
		const best = scored.reduce<(typeof scored)[number] | null>(
			(winner, chunk) =>
				chunk.similarity !== null && (!winner || chunk.similarity > winner.similarity!)
					? chunk
					: winner,
			null
		);
		return { chunks: scored.length, best };
	};
	const describe = async (id: string) => ({
		id,
		title: release.metadata.documents.find((d) => d.result.id === id)?.result.title ?? null,
		lexicalRank: position(lists.lexical, id),
		lexicalScore: matches.get(id)?.score ?? null,
		matchedTerms: matches.get(id)?.terms ?? [],
		semanticRank: position(lists.semantic, id),
		hybridRank: position(lists.hybrid, id),
		bestChunk: await chunkEvidence(id)
	});
	return {
		case: testCase,
		query: input.query,
		mode: input.mode,
		expected: await Promise.all(
			testCase.expectedBlockIds.map(async (id) => ({
				...(await describe(id)),
				searchTextExcerpt: sources.get(id)?.search_text.slice(0, 400) ?? null
			}))
		),
		leaders: await Promise.all(lists.hybrid.slice(0, top).map(describe))
	};
}

const fixed = (value: number) => value.toFixed(3);

export function formatExperimentReport(report: ExperimentReport): string {
	const row = (name: string, m: VariantMetrics, cost: { embeddedTexts: number }) =>
		`| ${name} | ${m.fixture.firstPagePasses}/${m.fixture.cases} | ${fixed(m.fixture.meanReciprocalRank)} | ${fixed(m.heldOut.meanReciprocalRank)} | ${fixed(m.heldOut.successAt1)} | ${m.invariantViolations.length} | ${m.vectors} | ${m.gzipBytes} | ${m.nodeSearchMs} | ${cost.embeddedTexts} |`;
	const caseIds = Object.keys(report.control.metrics.fixture.ranks);
	return [
		`# Search experiment: ${report.spec.name}`,
		'',
		`Spec ${report.specHash.slice(0, 12)}. Pins: ${Object.entries(report.pins)
			.map(([k, v]) => `${k} ${v.slice(0, 12)}`)
			.join(', ')}.`,
		`Held-out known-item queries: ${report.heldOutQueries.length} (seed ${report.spec.heldOut.seed}). Node timings only; mobile performance ${report.mobile}.`,
		'',
		'| Variant | Fixture first page | Fixture MRR | Held-out MRR | Held-out @1 | Invariant violations | Vectors | Gzip bytes | Node ms | Texts embedded |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		row('control (production)', report.control.metrics, report.control.cost),
		...report.variants.map((v) =>
			row(`${v.name} (${v.change.kind} ${v.change.value})`, v.metrics, v.cost)
		),
		'',
		'## Expected-block ranks per fixture case',
		'',
		`| Case | control | ${report.variants.map(({ name }) => name).join(' | ')} |`,
		`| --- | --- | ${report.variants.map(() => '---').join(' | ')} |`,
		...caseIds.map(
			(id) =>
				`| ${id} | ${report.control.metrics.fixture.ranks[id].join(', ') || '—'} | ${report.variants.map((v) => v.metrics.fixture.ranks[id].join(', ') || '—').join(' | ')} |`
		),
		'',
		report.suggestion
			? `Suggestion: **${report.suggestion.variant}**. ${report.suggestion.note}`
			: 'No variant beat the production control without losing a fixture case or an invariant.',
		''
	].join('\n');
}
