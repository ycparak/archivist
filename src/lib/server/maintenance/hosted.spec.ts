import { describe, expect, it, vi } from 'vitest';
import type { ArchiveBlock } from '$lib/domain/archive';
import { EMBEDDING } from '$lib/search/embedding';
import type { DiscoveredArchive, SyncSummary } from '$lib/server/indexing/sync';
import {
	bootstrapCaches,
	CACHE_POINTER_KEY,
	importIntoLocal,
	loadCanonicalCaches,
	mergeJobRecords,
	stageCodecs
} from './caches';
import {
	ADOPTED_LIVE_JOB_ID,
	jobKeys,
	loadStoredRelease,
	PRODUCTION_POINTER_KEY,
	recordHostedDeployment,
	stageHostedDeployment
} from './hosted-release';
import { dispatchSiteDeploy } from './github';
import { pruneArtifacts } from './retention';
import {
	HostedJobConfigurationError,
	runHostedSync,
	type HostedSyncDependencies
} from './hosted-sync';
import { acquireLease, fencedPut, LeaseHeldError, LeaseLostError } from './lease';
import { memoryStore, PreconditionFailedError, type ObjectStore } from './store';

const revision = 'a'.repeat(40);
const fingerprint = 'b'.repeat(64);
const channels = [{ slug: 'public', title: 'Public' }];
const block = (id: string): ArchiveBlock => ({
	id,
	type: 'Text',
	title: `Fox ${id}`,
	arenaUrl: `https://www.are.na/block/${id}`,
	channels
});
const summary = (): SyncSummary => ({
	channelsDiscovered: 1,
	channelsIgnored: 0,
	channelsPrivateSkipped: 0,
	channelsSynced: 1,
	channelsFailed: [],
	blocksFetched: 2,
	itemsSkipped: 0,
	blocksNormalized: 2,
	uniqueBlocks: 2,
	colour: null,
	connections: null,
	vision: null,
	writeBack: null
});
const discovered = (ids = ['1', '2'], complete = true): DiscoveredArchive => ({
	ownerId: 7,
	blocks: ids.map(block),
	channels,
	summary: summary(),
	complete
});
const fixture = Array.from({ length: 10 }, (_, i) => ({
	id: `case-${i}`,
	mode: 'lexical',
	q: 'fox',
	expectedBlockIds: ['block:1']
}));
const counted = (id: string, total = 3) => ({
	block_id: id,
	total,
	counted_at: '2026-10-14T00:00:00.000Z'
});
const payload = (jobId = 'job-one') => ({
	jobId,
	stages: { colour: false, connections: true },
	source: { sourceRevision: revision, sourceFingerprint: fingerprint }
});

async function bootstrapped() {
	const store = memoryStore();
	const lease = await acquireLease(store, { holder: 'bootstrap', renew: false });
	await bootstrapCaches(store, lease, {
		colour: new Map(),
		connections: new Map([['9', counted('9', 1)]]),
		vision: new Map()
	});
	await lease.release();
	return store;
}

function dependencies(
	store: ObjectStore,
	overrides: Partial<HostedSyncDependencies> = {}
): HostedSyncDependencies {
	return {
		store,
		discover: async () => discovered(),
		enrich: async (discovery, options) => {
			for (const { id } of discovery.blocks)
				if (!options.connectionCache?.has(id)) options.connections?.onEntry?.(counted(id));
			return { summary: discovery.summary };
		},
		embed: async (texts) =>
			texts.map(() => Array.from({ length: EMBEDDING.dimensions }, (_, i) => Number(i === 0))),
		fixture,
		signal: new AbortController().signal,
		gzipSize: async (bytes) => bytes.byteLength,
		heapBytes: () => 0,
		...overrides
	};
}

function ready<T extends { status: string }>(staged: T) {
	if (staged.status !== 'ready')
		throw new Error(`Expected a ready deployment, got ${staged.status}`);
	return staged as Extract<T, { status: 'ready' }>;
}

describe('archive lease', () => {
	it('excludes a second holder and fences a stale holder after takeover', async () => {
		const store = memoryStore();
		let clock = 0;
		const now = () => clock;
		const first = await acquireLease(store, { holder: 'a', ttlMs: 100, now, renew: false });
		await expect(acquireLease(store, { holder: 'b', now, renew: false })).rejects.toThrow(
			LeaseHeldError
		);
		await fencedPut(store, first, 'pointer.json', { value: 1 }, null);
		clock = 200;
		expect(() => first.assertHeld()).toThrow(LeaseLostError);
		const second = await acquireLease(store, { holder: 'b', ttlMs: 100, now, renew: false });
		expect(second.token).toBe(first.token + 1);
		const current = await store.get('pointer.json');
		await fencedPut(store, second, 'pointer.json', { value: 2 }, current!.etag);
		const stale = { ...first, assertHeld: () => {} };
		const latest = await store.get('pointer.json');
		await expect(
			fencedPut(store, stale, 'pointer.json', { value: 3 }, latest!.etag)
		).rejects.toThrow(LeaseLostError);
	});

	it('aborts the holder when renewal finds the lease taken over', async () => {
		vi.useFakeTimers();
		try {
			const store = memoryStore();
			const lease = await acquireLease(store, { holder: 'a', ttlMs: 300 });
			const lock = await store.get('locks/archive.json');
			await store.put('locks/archive.json', lock!.bytes);
			await vi.advanceTimersByTimeAsync(100);
			expect(lease.signal.aborted).toBe(true);
			expect(() => lease.assertHeld()).toThrow(LeaseLostError);
			await lease.release();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('hosted caches', () => {
	it('merges against the latest snapshot and rejects a pointer changed underneath', async () => {
		const store = await bootstrapped();
		const lease = await acquireLease(store, { holder: 'job', renew: false });
		const caches = await mergeJobRecords(store, lease, {
			jobId: 'job-one',
			records: { connections: [counted('1')] },
			liveBlockIds: new Set(['1'])
		});
		expect([...caches.connections.keys()]).toEqual(['1']);
		const pointer = await store.get(CACHE_POINTER_KEY);
		await store.put(CACHE_POINTER_KEY, pointer!.bytes);
		await expect(
			fencedPut(store, lease, CACHE_POINTER_KEY, { stale: true }, pointer!.etag)
		).rejects.toThrow(PreconditionFailedError);
	});

	it('exports snapshots that parse and serialize identically to local caches', async () => {
		const store = await bootstrapped();
		const { pointer } = await loadCanonicalCaches(store);
		const bytes = (await store.get(pointer.stages.connections.key))!.bytes;
		const text = new TextDecoder().decode(bytes);
		const codec = stageCodecs.connections;
		expect(codec.serialize(codec.parse(text).values())).toBe(text);
	});

	it('imports hosted entries without replacing newer local work', () => {
		const local = new Map([
			['1', { ...counted('1', 5), counted_at: '2026-10-20T00:00:00.000Z' }],
			['2', counted('2', 1)],
			['3', counted('3', 1)]
		]);
		const hosted = new Map([
			['1', counted('1', 9)],
			['2', { ...counted('2', 4), counted_at: '2026-10-15T00:00:00.000Z' }],
			['4', counted('4')]
		]);
		const { text, change } = importIntoLocal('connections', local, hosted);
		const merged = stageCodecs.connections.parse(text);
		expect(merged.get('1')!.total).toBe(5);
		expect(merged.get('2')!.total).toBe(4);
		expect(merged.has('3') && merged.has('4')).toBe(true);
		expect(change).toEqual({ added: 1, updated: 1, keptLocal: 1, localOnly: 1 });
	});
});

describe('hosted sync', () => {
	it('stages a validated candidate and merges settled records with pruning', async () => {
		const store = await bootstrapped();
		const report = await runHostedSync(payload(), dependencies(store));
		expect(report).toMatchObject({ status: 'completed', passed: true, blocks: 2 });
		const { caches } = await loadCanonicalCaches(store);
		expect([...caches.connections.keys()].sort()).toEqual(['1', '2']);
		expect(await store.get(`releases/${report.candidateVersion}/manifest.json`)).not.toBeNull();
		expect(await runHostedSync(payload(), dependencies(store))).toEqual(report);
	});

	it('resumes from pinned discovery and settled records without repeating work', async () => {
		const store = await bootstrapped();
		const discover = vi.fn(async () => discovered());
		let calls = 0;
		const enrich: HostedSyncDependencies['enrich'] = async (discovery, options) => {
			calls += 1;
			for (const { id } of discovery.blocks) {
				if (options.connectionCache?.has(id)) continue;
				if (calls === 1 && id === '2') throw new Error('Worker replaced');
				options.connections?.onEntry?.(counted(id));
			}
			return { summary: discovery.summary };
		};
		await expect(
			runHostedSync(payload(), dependencies(store, { discover, enrich }))
		).rejects.toThrow('Worker replaced');
		const counts: string[] = [];
		const report = await runHostedSync(
			payload(),
			dependencies(store, {
				discover,
				enrich: async (discovery, options) => {
					for (const { id } of discovery.blocks)
						if (!options.connectionCache?.has(id)) {
							counts.push(id);
							options.connections?.onEntry?.(counted(id));
						}
					return { summary: discovery.summary };
				}
			})
		);
		expect(discover).toHaveBeenCalledTimes(1);
		expect(counts).toEqual(['2']);
		expect(report.passed).toBe(true);
	});

	it('keeps stage results when an attempt fails after merging', async () => {
		const store = await bootstrapped();
		const stats = { blocks: 2, cacheHits: 0, counted: 2, failed: [] };
		const deps = (embed: HostedSyncDependencies['embed']) =>
			dependencies(store, {
				embed,
				enrich: async (discovery, options) => {
					for (const { id } of discovery.blocks) options.connections?.onEntry?.(counted(id));
					return { summary: { ...discovery.summary, connections: stats } };
				}
			});
		await expect(
			runHostedSync(
				payload(),
				deps(async () => {
					throw new Error('Embedding outage');
				})
			)
		).rejects.toThrow('Embedding outage');
		const report = await runHostedSync(payload(), deps(dependencies(store).embed));
		expect(report.stages.connections).toEqual(stats);
	});

	it('never persists or prunes after incomplete discovery', async () => {
		const store = await bootstrapped();
		const before = await store.get(CACHE_POINTER_KEY);
		await expect(
			runHostedSync(
				payload(),
				dependencies(store, { discover: async () => discovered(['1'], false) })
			)
		).rejects.toThrow('incomplete');
		expect(await store.get(jobKeys('job-one').discovery)).toBeNull();
		expect((await store.get(CACHE_POINTER_KEY))!.etag).toBe(before!.etag);
	});

	it('leaves a cancelled job unreportable and undeployable', async () => {
		const store = await bootstrapped();
		const abort = new AbortController();
		await expect(
			runHostedSync(
				payload(),
				dependencies(store, {
					signal: abort.signal,
					enrich: async (discovery) => {
						abort.abort();
						return { summary: discovery.summary };
					}
				})
			)
		).rejects.toThrow();
		expect(await store.get(jobKeys('job-one').report)).toBeNull();
		await expect(
			stageHostedDeployment({
				store,
				jobId: 'job-one',
				sourceRevision: revision,
				sourceFingerprint: fingerprint,
				fixture
			})
		).rejects.toThrow('not completed');
	});

	it('rejects a job while another holder has the lease and a reused job ID', async () => {
		const store = await bootstrapped();
		const other = await acquireLease(store, { holder: 'deploy', renew: false });
		await expect(runHostedSync(payload(), dependencies(store))).rejects.toThrow(LeaseHeldError);
		await other.release();
		const failing = dependencies(store, {
			enrich: async () => {
				throw new Error('Provider down');
			}
		});
		await expect(runHostedSync(payload('job-two'), failing)).rejects.toThrow('Provider down');
		const changed = { ...payload('job-two'), stages: { colour: true, connections: true } };
		await expect(runHostedSync(changed, dependencies(store))).rejects.toThrow(
			HostedJobConfigurationError
		);
	});
});

describe('hosted deployment', () => {
	it('records a passing deployment and rejects superseded or mismatched candidates', async () => {
		const store = await bootstrapped();
		await runHostedSync(payload('job-old'), dependencies(store));
		await runHostedSync(payload('job-new'), dependencies(store));
		const stage = (jobId: string, sourceRevision = revision) =>
			stageHostedDeployment({
				store,
				jobId,
				sourceRevision,
				sourceFingerprint: fingerprint,
				fixture
			});
		await expect(stage('job-new', 'c'.repeat(40))).rejects.toThrow('source revision');
		const lease = await acquireLease(store, { holder: 'deploy', renew: false });
		await recordHostedDeployment(store, lease, ready(await stage('job-new')));
		await lease.release();
		expect(await store.get(PRODUCTION_POINTER_KEY)).not.toBeNull();
		expect((await stage('job-new')).status).toBe('already-live');
		await expect(stage('job-old')).rejects.toThrow('superseded');
	});

	it('adopts the live release as baseline and decides deploy, unchanged or rejected', async () => {
		const store = await bootstrapped();
		const live = await bootstrapped();
		await runHostedSync(payload('job-seed'), dependencies(live));
		const { release, assets } = await loadStoredRelease(
			live,
			(await live.list('releases/'))[0].split('/')[1]
		);
		const site: typeof fetch = async (input) => {
			const path = new URL(String(input)).pathname;
			if (path === '/search/manifest.json') return new Response(JSON.stringify(release));
			const file = path.replace(`/search/releases/${release.version}/`, '');
			return assets.has(file)
				? new Response(new Uint8Array(assets.get(file)!))
				: new Response(null, { status: 404 });
		};
		const daily = (jobId: string, ids: string[]) =>
			runHostedSync(
				{ ...payload(jobId), gate: 'no-regression' },
				dependencies(store, {
					discover: async () => discovered(ids),
					liveSite: { url: 'https://site.test', fetchFn: site }
				})
			);
		expect((await daily('daily-same', ['1', '2'])).decision).toBe('unchanged');
		const pointer = await store.get(PRODUCTION_POINTER_KEY);
		expect(JSON.parse(new TextDecoder().decode(pointer!.bytes))).toMatchObject({
			version: release.version,
			jobId: ADOPTED_LIVE_JOB_ID,
			candidateFence: 0
		});
		const added = await daily('daily-added', ['1', '2', '3']);
		expect(added).toMatchObject({ decision: 'deploy', passed: true, sourceRevision: revision });
		const rejected = await runHostedSync(
			{ ...payload('daily-lost'), gate: 'no-regression' },
			dependencies(store, { discover: async () => discovered(['2', '3']) })
		);
		expect(rejected.decision).toBe('rejected');
	});
});

describe('retention', () => {
	it('keeps live, previous and newest candidates and expires old jobs', async () => {
		const store = memoryStore();
		const put = (key: string, value: unknown) =>
			store.put(key, new TextEncoder().encode(JSON.stringify(value)));
		const version = (n: number) => String(n).repeat(64);
		const day = 24 * 60 * 60 * 1000;
		const now = Date.parse('2026-12-01T00:00:00.000Z');
		for (let n = 1; n <= 9; n++) {
			await put(`releases/${version(n)}/manifest.json`, {});
			const at = new Date(now - (10 - n) * 10 * day).toISOString();
			await put(`jobs/job-${n}/job.json`, { createdAt: at });
			await put(`jobs/job-${n}/report.json`, {
				format: 1,
				jobId: `job-${n}`,
				status: 'completed',
				candidateVersion: version(n),
				passed: true,
				decision: 'deploy',
				sourceRevision: revision,
				blocks: 1,
				channels: 1,
				stages: {},
				completedAt: at
			});
		}
		await put(PRODUCTION_POINTER_KEY, {
			format: 1,
			fence: 1,
			version: version(1),
			jobId: 'job-1',
			candidateFence: 1,
			sourceRevision: revision,
			previousVersion: version(2),
			deployedAt: new Date(now).toISOString()
		});
		const lease = await acquireLease(store, { holder: 'prune', renew: false });
		const deleted = await pruneArtifacts(store, lease, { now, keepCandidates: 3 });
		const versions = new Set((await store.list('releases/')).map((key) => key.split('/')[1]));
		expect(versions).toEqual(new Set([1, 2, 7, 8, 9].map(version)));
		const jobs = new Set((await store.list('jobs/')).map((key) => key.split('/')[1]));
		expect(jobs).toEqual(new Set(['job-1', 'job-7', 'job-8', 'job-9']));
		expect(deleted).toEqual({ releases: 4, jobs: 5 });
	});
});

describe('site deploy dispatch', () => {
	it('dispatches the workflow with the job and revision and hides the token on failure', async () => {
		const calls: [string, RequestInit][] = [];
		const ok: typeof fetch = async (input, init) => {
			calls.push([String(input), init!]);
			return new Response(null, { status: 204 });
		};
		const options = {
			token: 'secret-token',
			repository: 'ycparak/archivist',
			jobId: 'daily-20261015',
			revision
		};
		await dispatchSiteDeploy(options, ok);
		expect(calls[0][0]).toBe(
			'https://api.github.com/repos/ycparak/archivist/actions/workflows/deploy-site.yml/dispatches'
		);
		expect(JSON.parse(String(calls[0][1].body))).toEqual({
			ref: 'main',
			inputs: { job_id: 'daily-20261015', revision }
		});
		const denied = dispatchSiteDeploy(options, async () => new Response(null, { status: 403 }));
		await expect(denied).rejects.toThrow('(403)');
		await expect(denied).rejects.not.toThrow('secret-token');
	});
});
