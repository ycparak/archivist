import { readFile } from 'node:fs/promises';
import {
	configuredEmbedder,
	fixtureFile,
	loadLocalRelease,
	searchOutput
} from './maintenance-files';
import {
	embedEvaluationQueries,
	evaluateRelease,
	formatEvaluationResult
} from '$lib/server/maintenance/evaluate';
import { searchEvaluationCasesSchema } from '$lib/server/search/evaluation';

async function main() {
	if (process.argv.slice(2).some((arg) => arg !== '--browser'))
		throw new Error('No arguments are required');
	const cases = searchEvaluationCasesSchema.parse(JSON.parse(await readFile(fixtureFile, 'utf8')));
	const release = await loadLocalRelease(searchOutput);
	const queries = await embedEvaluationQueries(cases, configuredEmbedder());
	const results = evaluateRelease(release, cases, queries);
	for (const result of results) console.log(formatEvaluationResult(result));
	if (results.some(({ passed }) => !passed)) process.exitCode = 1;
}
await main().catch((error: unknown) => {
	console.error({
		event: 'evaluation_failed',
		name: error instanceof Error ? error.name : 'Unknown error'
	});
	process.exitCode = 1;
});
