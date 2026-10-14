import { z } from 'zod';
import { searchEvaluationCasesSchema } from '$lib/server/release/evaluation';
import { EMBEDDING } from '$lib/search/embedding';
import { sha256 } from '$lib/server/release/release-builder';
import {
	evaluationCasesSchema,
	evaluateRelease,
	evaluationEvidence,
	GATE_POLICIES,
	queryVectorsSchema
} from './evaluate';
import { releaseAssets, type ValidatedRelease } from './release';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const candidateOriginSchema = z
	.object({
		format: z.literal(1),
		kind: z.literal('public-export'),
		complete: z.literal(true),
		sourceRevision: z.string().min(1),
		sourceFingerprint: hash,
		baselineVersion: hash.nullable(),
		maxRankDrop: z.number().int().nonnegative().nullable(),
		gate: z.enum(GATE_POLICIES),
		/** Hosted provenance: a candidate from an older lease fence is superseded by a newer deployment. */
		job: z
			.object({ id: z.string().min(1), fence: z.number().int().positive() })
			.strict()
			.nullable()
	})
	.strict()
	.refine(
		(origin) => origin.gate === 'strict' || origin.maxRankDrop !== null,
		'The no-regression gate needs an explicit rank tolerance'
	);
export type CandidateOrigin = z.infer<typeof candidateOriginSchema>;
const rankSchema = z
	.object({
		id: z.string(),
		rank: z.number().int().positive().nullable(),
		baselineRank: z.number().int().positive().nullable(),
		drop: z.number().int().nullable()
	})
	.strict();
const resultSchema = z
	.object({
		id: z.string(),
		pending: z.string().nullable(),
		resultCount: z.number().int().nonnegative(),
		ranks: z.array(rankSchema),
		firstPagePass: z.boolean(),
		knownFailure: z.boolean(),
		regression: z.boolean(),
		passed: z.boolean()
	})
	.strict();
export const validationReportSchema = z
	.object({
		format: z.literal(1),
		candidateVersion: hash,
		blockCount: z.number().int().positive(),
		vectorCount: z.number().int().positive(),
		originHash: hash,
		fixtureHash: hash,
		embeddingVersion: z.literal(EMBEDDING.version),
		queryPrefix: z.literal(EMBEDDING.queryPrefix),
		queryVectors: queryVectorsSchema,
		results: z.array(resultSchema).min(1),
		passed: z.boolean(),
		assets: z.array(
			z
				.object({
					file: z.string(),
					bytes: z.number().int().positive(),
					gzipBytes: z.number().int().positive()
				})
				.strict()
		),
		nodeSearchMs: z.number().nonnegative(),
		nodeHeapBytes: z.number().int().nonnegative(),
		mobile: z.literal('unverified')
	})
	.strict();
type ValidationReport = z.infer<typeof validationReportSchema>;
export const hashJson = (value: unknown) => sha256(new TextEncoder().encode(JSON.stringify(value)));

export async function validateCandidate(options: {
	candidate: ValidatedRelease;
	origin: CandidateOrigin;
	fixture: unknown;
	queryVectors: Record<string, number[]>;
	baseline?: ValidatedRelease;
	gzipSize: (bytes: Uint8Array) => Promise<number>;
	heapBytes: () => number;
}) {
	const { candidate, baseline } = options;
	const origin = candidateOriginSchema.parse(options.origin);
	if (origin.baselineVersion !== (baseline?.release.version ?? null))
		throw new Error('Pinned baseline mismatch');
	const cases = evaluationCasesSchema.parse(searchEvaluationCasesSchema.parse(options.fixture));
	const queries = queryVectorsSchema.parse(options.queryVectors);
	const results = evaluateRelease(
		candidate,
		cases,
		queries,
		baseline,
		origin.maxRankDrop,
		origin.gate
	);
	const assets = [];
	for (const asset of releaseAssets(candidate.release))
		assets.push({
			file: asset.file,
			bytes: asset.bytes,
			gzipBytes: await options.gzipSize(candidate.assets.get(asset.file)!)
		});
	return validationReportSchema.parse({
		format: 1,
		candidateVersion: candidate.release.version,
		blockCount: candidate.release.blockCount,
		vectorCount: candidate.release.vectorCount,
		originHash: await hashJson(origin),
		fixtureHash: await hashJson(cases),
		embeddingVersion: EMBEDDING.version,
		queryPrefix: EMBEDDING.queryPrefix,
		queryVectors: queries,
		results: evaluationEvidence(results),
		passed: results.every(({ passed }) => passed),
		assets,
		nodeSearchMs: results.reduce((sum, result) => sum + result.nodeSearchMs, 0),
		nodeHeapBytes: options.heapBytes(),
		mobile: 'unverified'
	});
}

export async function assertPromotion(options: {
	candidate: ValidatedRelease;
	origin: unknown;
	report: unknown;
	fixture: unknown;
	sourceFingerprint: string;
	baseline?: ValidatedRelease;
}) {
	const origin = candidateOriginSchema.parse(options.origin);
	const report = validationReportSchema.parse(options.report);
	if (origin.sourceFingerprint !== options.sourceFingerprint)
		throw new Error('Source fingerprint changed; validate a fresh candidate');
	if (origin.baselineVersion !== (options.baseline?.release.version ?? null))
		throw new Error('Active baseline changed');
	if (
		report.candidateVersion !== options.candidate.release.version ||
		report.originHash !== (await hashJson(origin))
	)
		throw new Error('Candidate/report identity mismatch');
	const cases = evaluationCasesSchema.parse(searchEvaluationCasesSchema.parse(options.fixture));
	if (report.fixtureHash !== (await hashJson(cases))) throw new Error('Evaluation fixture changed');
	const results = evaluateRelease(
		options.candidate,
		cases,
		report.queryVectors,
		options.baseline,
		origin.maxRankDrop,
		origin.gate
	);
	if (
		!report.passed ||
		!results.every(({ passed }) => passed) ||
		JSON.stringify(evaluationEvidence(results)) !== JSON.stringify(report.results)
	)
		throw new Error('Candidate evaluation does not pass or report evidence changed');
}

export function formatValidationReport(report: ValidationReport): string {
	const lines = [
		`# Search release validation`,
		'',
		`Candidate: ${report.candidateVersion}`,
		'',
		`Corpus: ${report.blockCount} blocks, ${report.vectorCount} vectors.`,
		`Result: ${report.passed ? 'passed' : 'failed'}. Known failures: ${report.results.filter(({ knownFailure }) => knownFailure).length}. Mobile performance: ${report.mobile}.`,
		'',
		'| Case | First page | Expected ranks (baseline) | Regression |',
		'| --- | --- | --- | --- |'
	];
	for (const result of report.results)
		lines.push(
			`| ${result.id} | ${result.firstPagePass ? 'pass' : 'fail'}${result.pending ? ' (pending)' : ''}${result.knownFailure ? ' (known)' : ''} | ${result.ranks.map(({ id, rank, baselineRank }) => `${id}: ${rank ?? 'missing'} (${baselineRank ?? '—'})`).join(', ') || 'no results expected'} | ${result.regression ? 'yes' : 'no'} |`
		);
	lines.push(
		'',
		`Raw assets: ${report.assets.reduce((sum, asset) => sum + asset.bytes, 0)} bytes. Gzip assets: ${report.assets.reduce((sum, asset) => sum + asset.gzipBytes, 0)} bytes.`,
		'',
		`Node search time: ${report.nodeSearchMs.toFixed(2)} ms. Node heap at reporting: ${report.nodeHeapBytes} bytes. These do not measure browser startup or mobile performance.`,
		''
	);
	return lines.join('\n');
}
