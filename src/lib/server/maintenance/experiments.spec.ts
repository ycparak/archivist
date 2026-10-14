import { describe, expect, it, vi } from 'vitest';
import { toSearchDocument } from '$lib/domain/archive';
import { EMBEDDING } from '$lib/search/embedding';
import type { SearchEvaluationCase } from '$lib/server/search/evaluation';
import { buildSearchRelease } from '$lib/server/search/release-builder';
import {
	experimentSpecSchema,
	heldOutCases,
	investigateCase,
	readOnlyStore,
	runExperiment,
	type ExperimentDependencies
} from './experiments';
import { loadValidatedRelease } from './release';
import { memoryStore } from './store';

const channels = [{ slug: 'public', title: 'Public' }];
const titles = [
	'Brutalist concrete library facade',
	'Hand drawn map of tidal islands',
	'Widget grid dashboard for weather',
	'Risograph poster with orange type',
	'Untitled',
	'Untitled',
	'Kinetic typography reel in black',
	'Museum signage system study'
];
const documents = titles.map((title, i) =>
	toSearchDocument({
		id: String(i + 1),
		type: 'Image',
		title,
		description: `${title} described at length for search.`.repeat(i % 3 === 0 ? 12 : 1),
		arenaUrl: `https://www.are.na/block/${i + 1}`,
		channels
	})
);
/** Deterministic, content-dependent unit vectors, so chunk variants really change embeddings. */
const embed = async (texts: string[]) =>
	texts.map((text) => {
		const vector = Array.from({ length: EMBEDDING.dimensions }, () => 0);
		vector[0] = 1;
		for (const word of text.toLowerCase().split(/\W+/).filter(Boolean))
			vector[1 + ([...word].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 383)] += 1;
		return vector;
	});
const fixture: SearchEvaluationCase[] = [
	{ id: 'widget', mode: 'hybrid', q: 'widget grid', expectedBlockIds: ['block:3'] },
	{ id: 'poster', mode: 'lexical', q: 'risograph poster', expectedBlockIds: ['block:4'] },
	{ id: 'browse', mode: 'browse', expectedBlockIds: ['block:1'] }
];
const spec = {
	format: 1,
	name: 'Ranking and chunking',
	discoveryJobId: 'daily-20261014',
	heldOut: { count: 4, seed: 7 },
	variants: [
		{ name: 'rrf-20', change: { kind: 'rrf-k', value: 20 } },
		{ name: 'prefix', change: { kind: 'lexical-prefix', value: true } },
		{ name: 'chunks-200', change: { kind: 'chunk-bytes', value: 200 } }
	]
};

function deps(overrides: Partial<ExperimentDependencies> = {}): ExperimentDependencies {
	return {
		documents,
		channels,
		fixture,
		embeddings: new Map(),
		saveEmbeddings: async () => {},
		queryVectors: {},
		saveQueryVectors: async () => {},
		embed,
		gzipSize: async (bytes) => bytes.byteLength,
		pins: { discovery: 'a'.repeat(64) },
		...overrides
	};
}

describe('experiment specs and isolation', () => {
	it('accepts one change per uniquely named variant and rejects unsafe values', () => {
		expect(experimentSpecSchema.parse(spec).variants).toHaveLength(3);
		const variant = (change: unknown) => ({ ...spec, variants: [{ name: 'x', change }] });
		expect(() =>
			experimentSpecSchema.parse(variant({ kind: 'chunk-bytes', value: 600 }))
		).toThrow();
		expect(() => experimentSpecSchema.parse(variant({ kind: 'model', value: 'other' }))).toThrow();
		expect(() =>
			experimentSpecSchema.parse({ ...spec, variants: [spec.variants[0], spec.variants[0]] })
		).toThrow('unique');
	});

	it('refuses every write to hosted storage', async () => {
		const store = readOnlyStore(memoryStore());
		await expect(store.put('caches/current.json', new Uint8Array())).rejects.toThrow('read-only');
		await expect(store.delete('caches/current.json')).rejects.toThrow('read-only');
	});

	it('draws a reproducible held-out set from unique, informative titles', () => {
		const first = heldOutCases(documents, { count: 10, seed: 7 });
		expect(heldOutCases(documents, { count: 10, seed: 7 })).toEqual(first);
		expect(first.some(({ q }) => q === 'Untitled')).toBe(false);
		expect(first.every(({ expectedBlockIds: [id] }) => /^block:\d+$/.test(id))).toBe(true);
		expect(first).toHaveLength(6);
	});
});

describe('running an experiment', () => {
	it('scores the control and each variant, charging embeddings only to chunk changes', async () => {
		const report = await runExperiment(spec, deps());
		const byName = Object.fromEntries(report.variants.map((v) => [v.name, v]));
		expect(report.control.metrics.invariantViolations).toEqual([]);
		expect(report.control.metrics.fixture.cases).toBe(3);
		expect(report.heldOutQueries).toHaveLength(4);
		expect(byName['rrf-20'].cost.embeddedTexts).toBe(0);
		expect(byName['rrf-20'].ranking.rrfK).toBe(20);
		expect(byName['chunks-200'].cost.embeddedTexts).toBeGreaterThan(0);
		expect(byName['chunks-200'].metrics.vectors).toBeGreaterThan(report.control.metrics.vectors);
		for (const variant of report.variants) expect(variant.metrics.invariantViolations).toEqual([]);
	});

	it('reproduces the same scores from saved query vectors and embeddings', async () => {
		const embeddings = new Map<string, number[]>();
		let saved: Record<string, number[]> = {};
		const first = await runExperiment(
			spec,
			deps({ embeddings, saveQueryVectors: async (v) => void (saved = v) })
		);
		const counted = vi.fn(embed);
		const second = await runExperiment(
			spec,
			deps({ embeddings, queryVectors: saved, embed: counted })
		);
		expect(counted).not.toHaveBeenCalled();
		const scores = (r: typeof first) =>
			[r.control, ...r.variants].map(({ metrics }) => [metrics.fixture, metrics.heldOut]);
		expect(scores(second)).toEqual(scores(first));
		expect(second.specHash).toBe(first.specHash);
	});

	it('gathers rank, term and chunk evidence for a case', async () => {
		const embeddings = new Map<string, number[]>();
		const built = await buildSearchRelease(documents, channels, embed, embeddings);
		const release = await loadValidatedRelease(built.release, async (a) =>
			built.assets.get(a.file)!
		);
		const [queryVector] = await embed([EMBEDDING.queryPrefix + 'widget grid']);
		const evidence = await investigateCase({
			release,
			documents,
			embeddings,
			testCase: fixture[0],
			queryVector
		});
		expect(evidence.expected[0]).toMatchObject({ id: 'block:3', hybridRank: expect.any(Number) });
		expect(evidence.expected[0].matchedTerms).toContain('widget');
		expect(evidence.expected[0].bestChunk?.best?.similarity).toEqual(expect.any(Number));
		expect(evidence.leaders.length).toBeGreaterThan(0);
	});
});
