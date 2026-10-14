import type { ArchiveBlock } from '$lib/domain/archive';
import { COLOUR_VERSION } from '$lib/server/indexing/colour/cache';
import { CONNECTION_COUNT_MAX_AGE_MS } from '$lib/server/indexing/connections/cache';
import { unsupportedFormatReason } from '$lib/server/indexing/vision';
import { isAnimated } from '$lib/server/indexing/vision/video';
import { imageSourceHash } from '$lib/server/indexing/vision/rendition';
import type { ArchiveCaches } from './caches';
import type { JobOutcomes, StoredOutcome } from './job-schemas';

export const VISION_STATES = [
	'valid',
	'missing',
	'stale-source',
	'stale-prompt',
	'stale-model',
	'stale-input-mode',
	'unsupported',
	'no-image'
] as const;
export type VisionState = (typeof VISION_STATES)[number];
const COLOUR_STATES = [
	'valid',
	'missing',
	'stale-source',
	'stale-version',
	'unsupported',
	'no-image'
] as const;
type ColourState = (typeof COLOUR_STATES)[number];
const CONNECTION_STATES = ['fresh', 'stale', 'missing'] as const;
type ConnectionState = (typeof CONNECTION_STATES)[number];

interface VisionTarget {
	model: string;
	promptVersion: number;
}

/** Why a block's generated text is or is not usable, checked in cache-key order. */
export function visionState(
	block: ArchiveBlock,
	caches: Pick<ArchiveCaches, 'vision'>,
	target: VisionTarget
): VisionState {
	if (!block.imageUrl) return 'no-image';
	if (unsupportedFormatReason(block.imageContentType)) return 'unsupported';
	const entry = caches.vision.get(block.id);
	if (!entry) return 'missing';
	if (entry.image_src_hash !== imageSourceHash(block.imageUrl)) return 'stale-source';
	if (entry.prompt_version !== target.promptVersion) return 'stale-prompt';
	if (entry.model !== target.model) return 'stale-model';
	if (entry.input_mode !== (isAnimated(block.imageContentType) ? 'video' : 'image'))
		return 'stale-input-mode';
	return 'valid';
}

function colourState(block: ArchiveBlock, caches: Pick<ArchiveCaches, 'colour'>): ColourState {
	if (!block.imageUrl) return 'no-image';
	if (unsupportedFormatReason(block.imageContentType)) return 'unsupported';
	const entry = caches.colour.get(block.id);
	if (!entry) return 'missing';
	if (entry.image_src_hash !== imageSourceHash(block.imageUrl)) return 'stale-source';
	if (entry.colour_version !== COLOUR_VERSION) return 'stale-version';
	return 'valid';
}

export function connectionState(
	block: ArchiveBlock,
	caches: Pick<ArchiveCaches, 'connections'>,
	now: Date
): ConnectionState {
	const entry = caches.connections.get(block.id);
	if (!entry) return 'missing';
	return now.getTime() - Date.parse(entry.counted_at) < CONNECTION_COUNT_MAX_AGE_MS
		? 'fresh'
		: 'stale';
}

interface Bucket {
	count: number;
	/** At most `listLimit` IDs, so a report stays readable on a large archive. */
	blockIds: string[];
}

function tally<S extends string>(states: readonly S[], entries: [string, S][], limit: number) {
	const buckets = Object.fromEntries(
		states.map((s): [S, Bucket] => [s, { count: 0, blockIds: [] }])
	) as Record<S, Bucket>;
	for (const [id, state] of entries) {
		buckets[state].count += 1;
		if (buckets[state].blockIds.length < limit) buckets[state].blockIds.push(id);
	}
	return buckets;
}

interface GroupCoverage {
	blocks: number;
	withImage: number;
	visionValid: number;
	colourValid: number;
}

function groupBy(
	blocks: ArchiveBlock[],
	key: (block: ArchiveBlock) => string[],
	vision: Map<string, VisionState>,
	colour: Map<string, ColourState>
): Record<string, GroupCoverage> {
	const groups: Record<string, GroupCoverage> = {};
	for (const block of blocks)
		for (const name of key(block)) {
			const group = (groups[name] ??= { blocks: 0, withImage: 0, visionValid: 0, colourValid: 0 });
			group.blocks += 1;
			if (block.imageUrl) group.withImage += 1;
			if (vision.get(block.id) === 'valid') group.visionValid += 1;
			if (colour.get(block.id) === 'valid') group.colourValid += 1;
		}
	return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Read-only enrichment coverage for a pinned corpus. It makes no model calls and no Are.na
 * requests; generated text is reported as a retrieval input, never as a result field.
 */
export function buildCoverageReport(options: {
	jobId: string;
	blocks: ArchiveBlock[];
	caches: ArchiveCaches;
	outcomes: JobOutcomes | null;
	vision: VisionTarget;
	now: Date;
	listLimit?: number;
}) {
	const { blocks, caches, vision: target, now, listLimit = 50 } = options;
	const vision = new Map(blocks.map((b) => [b.id, visionState(b, caches, target)]));
	const colour = new Map(blocks.map((b) => [b.id, colourState(b, caches)]));
	const connections = blocks.map(
		(b) => [b.id, connectionState(b, caches, now)] as [string, ConnectionState]
	);
	const recent = (stage: keyof JobOutcomes) => {
		// Jobs before per-block outcomes existed recorded none; that is unknown, not zero.
		if (!options.outcomes) return { recorded: false, count: 0, retryable: 0, outcomes: [] };
		const all: StoredOutcome[] = options.outcomes[stage];
		return {
			recorded: true,
			count: all.length,
			retryable: all.filter((o) => o.retryable).length,
			outcomes: all.slice(0, listLimit)
		};
	};
	return {
		format: 1 as const,
		jobId: options.jobId,
		generatedAt: now.toISOString(),
		blocks: blocks.length,
		vision: {
			target,
			states: tally(VISION_STATES, [...vision], listLimit),
			videoInputs: blocks.filter((b) => b.imageUrl && isAnimated(b.imageContentType)).length
		},
		colour: {
			version: COLOUR_VERSION,
			states: tally(COLOUR_STATES, [...colour], listLimit),
			recent: recent('colour')
		},
		connections: {
			states: tally(CONNECTION_STATES, connections, listLimit),
			recent: recent('connections')
		},
		byChannel: groupBy(blocks, (b) => b.channels.map(({ slug }) => slug), vision, colour),
		byType: groupBy(blocks, (b) => [b.type], vision, colour)
	};
}
type CoverageReport = ReturnType<typeof buildCoverageReport>;

const percent = (part: number, whole: number) =>
	whole ? `${((part / whole) * 100).toFixed(1)}%` : '—';

export function formatCoverageReport(report: CoverageReport): string {
	const row = (name: string, bucket: Bucket) =>
		`| ${name} | ${bucket.count} | ${bucket.blockIds.slice(0, 5).join(', ')}${bucket.count > 5 ? ', …' : ''} |`;
	const states = <S extends string>(title: string, buckets: Record<S, Bucket>) => [
		`## ${title}`,
		'',
		'| State | Blocks | Examples |',
		'| --- | --- | --- |',
		...(Object.entries(buckets) as [S, Bucket][]).map(([s, b]) => row(s, b)),
		''
	];
	const eligible =
		report.blocks - report.vision.states['no-image'].count - report.vision.states.unsupported.count;
	return [
		'# Enrichment coverage',
		'',
		`Job ${report.jobId}: ${report.blocks} blocks, generated ${report.generatedAt}.`,
		`Vision: ${report.vision.states.valid.count} of ${eligible} describable blocks valid (${percent(report.vision.states.valid.count, eligible)}) for ${report.vision.target.model}, prompt v${report.vision.target.promptVersion}. ${report.vision.videoInputs} are animations read as video.`,
		report.colour.recent.recorded
			? `Recent failures: colour ${report.colour.recent.count} (${report.colour.recent.retryable} retryable), connections ${report.connections.recent.count} (${report.connections.recent.retryable} retryable).`
			: 'Recent failures: not recorded for this job (it predates per-block outcomes).',
		'',
		...states('Vision', report.vision.states),
		...states('Colour', report.colour.states),
		...states('Connections', report.connections.states),
		'## By channel',
		'',
		'| Channel | Blocks | With image | Vision valid | Colour valid |',
		'| --- | --- | --- | --- | --- |',
		...Object.entries(report.byChannel).map(
			([name, g]) =>
				`| ${name} | ${g.blocks} | ${g.withImage} | ${g.visionValid} | ${g.colourValid} |`
		),
		'',
		'## By block type',
		'',
		'| Type | Blocks | With image | Vision valid | Colour valid |',
		'| --- | --- | --- | --- | --- |',
		...Object.entries(report.byType).map(
			([name, g]) =>
				`| ${name} | ${g.blocks} | ${g.withImage} | ${g.visionValid} | ${g.colourValid} |`
		),
		''
	].join('\n');
}
