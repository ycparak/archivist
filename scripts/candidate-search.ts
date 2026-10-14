import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { syncArchive } from '$lib/server/indexing/sync';
import { parseSlugList } from '$lib/server/indexing/channel-filter';
import {
	assertPromotion,
	candidateOriginSchema,
	formatValidationReport
} from '$lib/server/maintenance/candidate';
import { prepareArchiveSearch } from './publish-search';
import { prepareCandidate } from '$lib/server/maintenance/prepare';
import { publishSearchRelease, withSearchPublication } from './search-files';
import {
	atomicWrite,
	fixtureFile,
	loadArchiveCaches,
	loadLocalRelease,
	loadOptionalRelease,
	searchOutput,
	sourceIdentity,
	validateLocalCandidate
} from './maintenance-files';

const command = z.enum(['prepare', 'validate', 'promote']).parse(process.argv[2]);
const path = process.argv[3];
if (!path || process.argv.length > 4)
	throw new Error('Usage: candidate-search.ts prepare|validate|promote <candidate-directory>');
const output = pathToFileURL(resolve(path) + '/');
if (output.href.startsWith(searchOutput.href))
	throw new Error('Candidate directory must be separate from public search assets');
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => abort.abort());

async function main() {
	if (command === 'prepare') {
		await mkdir(new URL('../', output), { recursive: true });
		await mkdir(output, { recursive: false });
		const baseline = await loadOptionalRelease(searchOutput);
		const identity = await sourceIdentity();
		const caches = await loadArchiveCaches();
		const accessToken = z.string().min(1).parse(process.env.ARENA_ACCESS_TOKEN);
		const { release } = await prepareCandidate({
			origin: candidateOriginSchema.parse({
				format: 1,
				kind: 'public-export',
				complete: true,
				...identity,
				baselineVersion: baseline?.release.version ?? null,
				maxRankDrop: null
			}),
			signal: abort.signal,
			discover: () =>
				syncArchive({
					accessToken,
					output: 'export',
					signal: abort.signal,
					...caches,
					channelFilter: {
						ignore: parseSlugList(process.env.ARENA_IGNORE_CHANNELS),
						allowPrivate: new Set()
					}
				}),
			build: (documents, channels) => prepareArchiveSearch(documents, channels, abort.signal),
			persist: async ({ release, assets, origin }) => {
				await publishSearchRelease(output, release, assets);
				await atomicWrite(new URL('origin.json', output), JSON.stringify(origin));
			}
		});
		console.log(`Prepared candidate ${release.version}. The active release is unchanged.`);
	} else if (command === 'validate') {
		const report = await validateLocalCandidate(output);
		await atomicWrite(new URL('validation.json', output), JSON.stringify(report));
		await atomicWrite(new URL('validation.md', output), formatValidationReport(report));
		console.log(formatValidationReport(report));
		if (!report.passed) process.exitCode = 1;
	} else {
		await withSearchPublication(searchOutput, async (publish) => {
			const candidate = await loadLocalRelease(output);
			await assertPromotion({
				candidate,
				origin: JSON.parse(await readFile(new URL('origin.json', output), 'utf8')),
				report: JSON.parse(await readFile(new URL('validation.json', output), 'utf8')),
				fixture: JSON.parse(await readFile(fixtureFile, 'utf8')),
				...(await sourceIdentity()),
				baseline: await loadOptionalRelease(searchOutput)
			});
			abort.signal.throwIfAborted();
			await publish(candidate.release, candidate.assets);
		});
		console.log('Promoted validated local release. Build/deploy is a separate action.');
	}
}
await main().catch((error: unknown) => {
	console.error({
		event: 'candidate_search_failed',
		error: error instanceof Error ? error.message : 'Unknown error'
	});
	process.exitCode = 1;
});
