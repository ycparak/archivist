import { describe, expect, it } from 'vitest';
import { toSearchDocument } from '$lib/domain/archive';
import { EMBEDDING } from '$lib/search/embedding';
import { buildSearchRelease, sha256 } from '$lib/server/search/release-builder';
import {
	assertPromotion,
	candidateOriginSchema,
	hashJson,
	validateCandidate,
	type CandidateOrigin
} from './candidate';
import { embedEvaluationQueries, evaluateRelease } from './evaluate';
import { loadValidatedRelease, releaseVersion } from './release';

const channels = [{ slug: 'public', title: 'Public' }];
const fixture = Array.from({ length: 10 }, (_, i) => ({
	id: `fox-${i}`,
	mode: 'lexical' as const,
	q: 'fox',
	expectedBlockIds: ['block:1']
}));
const vector = () => Array.from({ length: EMBEDDING.dimensions }, (_, i) => Number(i === 0));
async function build(count = 1) {
	const docs = Array.from({ length: count }, (_, i) =>
		toSearchDocument({
			id: String(i + 1),
			type: 'Text',
			title: 'fox',
			arenaUrl: `https://www.are.na/block/${i + 1}`,
			channels
		})
	);
	return buildSearchRelease(docs, channels, async (texts) => texts.map(vector));
}
async function loaded(count = 1) {
	const built = await build(count);
	return loadValidatedRelease(built.release, async (asset) => built.assets.get(asset.file)!);
}
const origin = (baselineVersion: string | null = null): CandidateOrigin => ({
	format: 1,
	kind: 'public-export',
	complete: true,
	sourceRevision: 'test',
	sourceFingerprint: 'a'.repeat(64),
	baselineVersion,
	maxRankDrop: null,
	gate: 'strict',
	job: null
});
async function reportFor(candidate: Awaited<ReturnType<typeof loaded>>) {
	return validateCandidate({
		candidate,
		origin: origin(),
		fixture,
		queryVectors: {},
		gzipSize: async (bytes) => bytes.length,
		heapBytes: () => 0
	});
}

describe('release validation', () => {
	it('rejects corrupted bytes and descriptor identity', async () => {
		const built = await build();
		await expect(
			loadValidatedRelease(built.release, async (asset) => new Uint8Array(asset.bytes))
		).rejects.toThrow('integrity');
		await expect(
			loadValidatedRelease({ ...built.release, version: '0'.repeat(64) }, async (asset) =>
				built.assets.get(asset.file)!
			)
		).rejects.toThrow('descriptor');
	});
	it.each(['lexical', 'bootstrap', 'vectors'] as const)(
		'rejects cross-file %s corruption even with updated hashes',
		async (kind) => {
			const built = await build();
			const asset = kind === 'vectors' ? built.release.vectors[0] : built.release[kind];
			let bytes: Uint8Array;
			if (kind === 'vectors') bytes = new Uint8Array(asset.bytes);
			else {
				const data = JSON.parse(new TextDecoder().decode(built.assets.get(asset.file)!));
				if (kind === 'lexical') data.documentIds['0'] = 'block:other';
				else data.results[0].title = 'Unexpected';
				bytes = new TextEncoder().encode(JSON.stringify(data));
			}
			built.assets.set(asset.file, bytes);
			asset.bytes = bytes.length;
			asset.sha256 = await sha256(bytes);
			built.release.version = await releaseVersion(built.release);
			await expect(
				loadValidatedRelease(built.release, async (a) => built.assets.get(a.file)!)
			).rejects.toThrow(
				kind === 'lexical' ? 'Lexical' : kind === 'bootstrap' ? 'Bootstrap' : 'normalized'
			);
		}
	);
	it('rejects empty channel membership despite valid checksums', async () => {
		const built = await build();
		const asset = built.release.metadata;
		const data = JSON.parse(new TextDecoder().decode(built.assets.get(asset.file)!));
		data.documents[0].result.channelSlugs = [];
		const bytes = new TextEncoder().encode(JSON.stringify(data));
		built.assets.set(asset.file, bytes);
		asset.bytes = bytes.length;
		asset.sha256 = await sha256(bytes);
		built.release.version = await releaseVersion(built.release);
		await expect(
			loadValidatedRelease(built.release, async (a) => built.assets.get(a.file)!)
		).rejects.toThrow('membership');
	});
});

describe('full ranking evaluation', () => {
	it('reports a rank beyond the first page and keeps the fixture failing', async () => {
		const candidate = await loaded(30);
		const results = evaluateRelease(
			candidate,
			[{ ...fixture[0], expectedBlockIds: ['block:9'] }],
			{}
		);
		expect(results[0].ranks[0].rank).toBe(30);
		expect(results[0].passed).toBe(false);
	});
	it('handles pending and no-result targets while gating baseline regression', async () => {
		const candidate = await loaded(30),
			baseline = await loaded();
		const results = evaluateRelease(
			candidate,
			[
				{ ...fixture[0], expectedBlockIds: ['block:9'], pending: 'Future target' },
				{ id: 'none', mode: 'browse', channel: ['absent'], expectedBlockIds: [] }
			],
			{},
			baseline,
			0
		);
		expect(results.map(({ passed }) => passed)).toEqual([true, true]);
		const smaller = await loaded();
		const missing = evaluateRelease(
			smaller,
			[{ ...fixture[0], expectedBlockIds: ['block:9'] }],
			{},
			candidate,
			0
		);
		expect(missing[0].regression).toBe(true);
		expect(missing[0].passed).toBe(false);
	});
});

describe('no-regression gate', () => {
	// Ties order by ID string, so block:9 sits below every two-digit ID: rank 30 of 30, 35 of 35.
	const miss = [{ ...fixture[0], expectedBlockIds: ['block:9'] }];
	it('accepts a pre-existing miss within tolerance and reports it as known', async () => {
		const baseline = await loaded(30),
			candidate = await loaded(35);
		const [result] = evaluateRelease(candidate, miss, {}, baseline, 10, 'no-regression');
		expect(result.ranks[0]).toMatchObject({ rank: 35, baselineRank: 30 });
		expect(result).toMatchObject({ firstPagePass: false, knownFailure: true, passed: true });
		const [strict] = evaluateRelease(candidate, miss, {}, baseline, 10, 'strict');
		expect(strict.passed).toBe(false);
	});
	it('rejects a known miss that slips beyond tolerance or disappears', async () => {
		const baseline = await loaded(30);
		const [slipped] = evaluateRelease(await loaded(35), miss, {}, baseline, 4, 'no-regression');
		expect(slipped).toMatchObject({ knownFailure: true, regression: true, passed: false });
		const [gone] = evaluateRelease(await loaded(8), miss, {}, baseline, 10, 'no-regression');
		expect(gone).toMatchObject({ knownFailure: true, passed: false });
	});
	it('still requires a case the baseline passes to stay on the first page', async () => {
		const passing = [{ ...fixture[0], expectedBlockIds: ['block:2'] }];
		const [result] = evaluateRelease(
			await loaded(1),
			passing,
			{},
			await loaded(30),
			10,
			'no-regression'
		);
		expect(result).toMatchObject({ knownFailure: false, passed: false });
	});
	it('requires an explicit tolerance for the no-regression gate', () => {
		expect(() =>
			candidateOriginSchema.parse({ ...origin(), gate: 'no-regression', maxRankDrop: null })
		).toThrow('tolerance');
	});
});

describe('promotion evidence', () => {
	it('accepts exact passing evidence and rejects changed source/fixture/baseline/candidate', async () => {
		const candidate = await loaded(),
			report = await reportFor(candidate);
		const options = {
			candidate,
			origin: origin(),
			report,
			fixture,
			sourceFingerprint: origin().sourceFingerprint
		};
		await expect(assertPromotion(options)).resolves.toBeUndefined();
		await expect(
			assertPromotion({ ...options, sourceFingerprint: 'b'.repeat(64) })
		).rejects.toThrow('Source');
		await expect(
			assertPromotion({ ...options, fixture: fixture.map((item) => ({ ...item, q: 'different' })) })
		).rejects.toThrow('fixture');
		await expect(assertPromotion({ ...options, baseline: candidate })).rejects.toThrow('baseline');
		await expect(assertPromotion({ ...options, candidate: await loaded(2) })).rejects.toThrow(
			'identity'
		);
	});
	it('rejects forged pass evidence and non-export provenance', async () => {
		const candidate = await loaded(),
			report = await reportFor(candidate);
		const options = {
			candidate,
			origin: origin(),
			report,
			fixture,
			sourceFingerprint: origin().sourceFingerprint
		};
		await expect(
			assertPromotion({
				...options,
				report: { ...report, results: [{ ...report.results[0], resultCount: 100 }] }
			})
		).rejects.toThrow('evidence');
		const fakeOrigin = { ...origin(), kind: 'synthetic' };
		await expect(
			assertPromotion({
				...options,
				origin: fakeOrigin,
				report: { ...report, originHash: await hashJson(fakeOrigin) }
			})
		).rejects.toThrow();
		const failingFixture = fixture.map((item) => ({
			...item,
			expectedBlockIds: ['block:missing']
		}));
		const failed = await validateCandidate({
			candidate,
			origin: origin(),
			fixture: failingFixture,
			queryVectors: {},
			gzipSize: async (bytes) => bytes.length,
			heapBytes: () => 0
		});
		await expect(
			assertPromotion({ ...options, fixture: failingFixture, report: { ...failed, passed: true } })
		).rejects.toThrow('does not pass');
	});
});

it('rejects truncated public fixtures', async () => {
	const candidate = await loaded();
	await expect(
		validateCandidate({
			candidate,
			origin: origin(),
			fixture: [fixture[0]],
			queryVectors: {},
			gzipSize: async (bytes) => bytes.length,
			heapBytes: () => 0
		})
	).rejects.toThrow();
});

it('shares query embeddings across semantic/hybrid cases and detects changed vector evidence', async () => {
	const candidate = await loaded();
	const cases = fixture.map((testCase, i) => ({
		...testCase,
		mode: i % 2 ? ('semantic' as const) : ('hybrid' as const)
	}));
	let calls = 0;
	const queries = await embedEvaluationQueries(cases, async (texts) => {
		calls++;
		return texts.map(vector);
	});
	expect(calls).toBe(1);
	expect(Object.keys(queries)).toHaveLength(1);
	const report = await validateCandidate({
		candidate,
		origin: origin(),
		fixture: cases,
		queryVectors: queries,
		gzipSize: async (bytes) => bytes.length,
		heapBytes: () => 0
	});
	expect(report.passed).toBe(true);
	const badQueries = Object.fromEntries(
		Object.keys(queries).map((key) => [key, Array(EMBEDDING.dimensions).fill(0)])
	);
	await expect(
		assertPromotion({
			candidate,
			origin: origin(),
			report: { ...report, queryVectors: badQueries },
			fixture: cases,
			sourceFingerprint: origin().sourceFingerprint
		})
	).rejects.toThrow('norm');
});
