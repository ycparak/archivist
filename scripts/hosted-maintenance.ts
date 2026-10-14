import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { tasks } from '@trigger.dev/sdk';
import { z } from 'zod';
import {
	bootstrapCaches,
	CACHE_POINTER_KEY,
	CACHE_STAGES,
	hostedEmbeddingCache,
	importIntoLocal,
	loadCanonicalCaches,
	stageCodecs
} from '$lib/server/maintenance/caches';
import {
	jobIdSchema,
	recordHostedDeployment,
	stageHostedDeployment
} from '$lib/server/maintenance/hosted-release';
import { hostedSyncPayloadSchema } from '$lib/server/maintenance/hosted-sync';
import { acquireLease } from '$lib/server/maintenance/lease';
import { createR2Store } from '$lib/server/maintenance/r2';
import type { archiveSyncTask } from '../src/trigger/sync';
import {
	atomicWrite,
	fixtureFile,
	loadArchiveCaches,
	localEmbeddingCache,
	optionalRead,
	searchOutput,
	sourceIdentity,
	workspace
} from './maintenance-files';
import { publishSearchRelease } from './search-files';

const USAGE = `Usage:
  hosted-maintenance.ts bootstrap
  hosted-maintenance.ts pull
  hosted-maintenance.ts sync [--no-colour] [--no-connections] [--no-regression] [--resume <job-id>]
  hosted-maintenance.ts deploy <job-id> [--dry-run]
  hosted-maintenance.ts identity`;

const [command, ...args] = process.argv.slice(2);
const store = () => createR2Store(process.env);
const holder = `cli:${hostname()}:${process.pid}`;
const cacheRoot = new URL('../src/lib/server/indexing/', import.meta.url);
const cacheFiles = {
	colour: 'colour-cache.jsonl',
	connections: 'connections-cache.jsonl',
	vision: 'vision-cache.jsonl'
} as const;

function git(...gitArgs: string[]) {
	return execFileSync('git', gitArgs, { cwd: workspace, encoding: 'utf8' }).trim();
}

function requireCleanCheckout() {
	if (git('status', '--porcelain'))
		throw new Error('Commit or stash changes first; hosted jobs record the checked-out source');
}

/** Asynchronous so lease renewal keeps running during long builds and deploys. */
function run(executable: string, runArgs: string[], env: NodeJS.ProcessEnv = process.env) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(executable, runArgs, { cwd: workspace, stdio: 'inherit', env });
		child.on('error', reject);
		child.on('exit', (code) =>
			code === 0 ? resolve() : reject(new Error(`${executable} ${runArgs.join(' ')} failed`))
		);
	});
}

async function bootstrap() {
	if (args.length) throw new Error(USAGE);
	const target = store();
	if (await target.get(CACHE_POINTER_KEY))
		throw new Error('Hosted caches are already bootstrapped');
	const lease = await acquireLease(target, { holder });
	try {
		const { visionCache, colourCache, connectionCache } = await loadArchiveCaches();
		await bootstrapCaches(target, lease, {
			colour: colourCache,
			connections: connectionCache,
			vision: visionCache
		});
		const embeddings = await hostedEmbeddingCache(target);
		await embeddings.checkpoint((await localEmbeddingCache()).entries);
		console.log(
			`Bootstrapped hosted caches: ${colourCache.size} colour, ${connectionCache.size} connections, ${visionCache.size} vision entries.`
		);
	} finally {
		await lease.release();
	}
}

async function pull() {
	if (args.length) throw new Error(USAGE);
	const { caches, pointer } = await loadCanonicalCaches(store());
	const changes: Record<string, unknown> = {};
	for (const stage of CACHE_STAGES) {
		const file = new URL(cacheFiles[stage], cacheRoot);
		const local = stageCodecs[stage].parse((await optionalRead(file)) ?? '');
		const { text, change } = importIntoLocal(stage, local as never, caches[stage] as never);
		await writeFile(file, text);
		changes[stage] = change;
	}
	const report = { pulledAt: new Date().toISOString(), hostedJob: pointer.jobId, changes };
	await atomicWrite(
		new URL('.maintenance/cache-changes.json', workspace),
		JSON.stringify(report, null, '\t')
	);
	console.log(JSON.stringify(report, null, 2));
	console.log('Review the cache diff with git before committing.');
}

async function sync() {
	const flags = z
		.object({
			colour: z.boolean(),
			connections: z.boolean(),
			noRegression: z.boolean(),
			resume: jobIdSchema.optional()
		})
		.parse({
			colour: !args.includes('--no-colour'),
			connections: !args.includes('--no-connections'),
			noRegression: args.includes('--no-regression'),
			resume: args.includes('--resume') ? args[args.indexOf('--resume') + 1] : undefined
		});
	const known = new Set([
		'--no-colour',
		'--no-connections',
		'--no-regression',
		'--resume',
		flags.resume
	]);
	if (args.some((arg) => !known.has(arg))) throw new Error(USAGE);
	requireCleanCheckout();
	const jobId =
		flags.resume ??
		`sync-${new Date()
			.toISOString()
			.replace(/[^0-9]/g, '')
			.slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
	const payload = hostedSyncPayloadSchema.parse({
		jobId,
		stages: { colour: flags.colour, connections: flags.connections },
		gate: flags.noRegression ? 'no-regression' : 'strict',
		source: await sourceIdentity()
	});
	// A resumed job needs a fresh run key: reusing the original would return the exhausted run.
	const idempotencyKey = flags.resume ? `${jobId}-resume-${Date.now()}` : jobId;
	const handle = await tasks.trigger<typeof archiveSyncTask>('archive-sync', payload, {
		idempotencyKey
	});
	console.log(`Triggered ${jobId} as run ${handle.id}. Vision and Are.na write-back are disabled.`);
}

async function deploy() {
	const jobId = jobIdSchema.parse(args[0]);
	const dryRun = args.includes('--dry-run');
	if (args.slice(1).some((arg) => arg !== '--dry-run')) throw new Error(USAGE);
	requireCleanCheckout();
	const target = store();
	const lease = await acquireLease(target, { holder: `deploy:${holder}` });
	try {
		const result = await stageHostedDeployment({
			store: target,
			jobId,
			sourceRevision: git('rev-parse', 'HEAD'),
			sourceFingerprint: (await sourceIdentity()).sourceFingerprint,
			fixture: JSON.parse(await readFile(fixtureFile, 'utf8'))
		});
		if (result.status === 'already-live') {
			console.log(`${jobId} is already live; nothing to deploy.`);
			return;
		}
		const staged = result;
		// Only the deployed baseline and the candidate ship; local or CI synthetic assets are set aside.
		if (await optionalRead(new URL('manifest.json', searchOutput))) {
			const aside = new URL(`.maintenance/static-search-${Date.now()}/`, workspace);
			await mkdir(new URL('.maintenance/', workspace), { recursive: true });
			await rename(searchOutput, aside);
			console.log(`Moved previous local search assets to ${aside.pathname}`);
		}
		if (staged.baseline)
			await publishSearchRelease(searchOutput, staged.baseline.release, staged.baseline.assets);
		await publishSearchRelease(searchOutput, staged.candidate.release, staged.candidate.assets);
		lease.assertHeld();
		await run('bun', ['run', 'build']);
		if (dryRun) {
			console.log(`Dry run: built candidate ${staged.candidate.release.version}; not deployed.`);
			return;
		}
		const env = { ...process.env };
		// The local Workers AI token is not a deployment credential; use a dedicated token or wrangler login.
		if (process.env.CLOUDFLARE_DEPLOY_API_TOKEN)
			env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_DEPLOY_API_TOKEN;
		else delete env.CLOUDFLARE_API_TOKEN;
		lease.assertHeld();
		// Not bunx: Bun would reload .env into the child and reintroduce the Workers AI token.
		await run(
			fileURLToPath(new URL('node_modules/.bin/wrangler', workspace)),
			['deploy', '--env-file=.env.example'],
			env
		);
		await recordHostedDeployment(target, lease, staged);
		console.log(`Deployed candidate ${staged.candidate.release.version} from ${jobId}.`);
	} finally {
		await lease.release();
	}
}

/** CI writes the checkout's identity into the Trigger bundle so scheduled jobs record their source. */
async function identity() {
	if (args.length) throw new Error(USAGE);
	requireCleanCheckout();
	const value = await sourceIdentity();
	await writeFile(
		new URL('src/trigger/source-identity.ts', workspace),
		`export const SOURCE_IDENTITY: { sourceRevision: string; sourceFingerprint: string } | null = ${JSON.stringify(value)};\n`
	);
	console.log(`Recorded source identity ${value.sourceRevision}.`);
}

const commands: Record<string, () => Promise<void>> = { bootstrap, pull, sync, deploy, identity };
await (commands[command ?? ''] ?? (async () => Promise.reject(new Error(USAGE))))().catch(
	(error: unknown) => {
		console.error({
			event: 'hosted_maintenance_failed',
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		process.exitCode = 1;
	}
);
