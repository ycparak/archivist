import Turbopuffer from '@turbopuffer/turbopuffer';
import type { SearchDocument } from '$lib/domain/archive';
import { archiveDistanceMetric, archiveNamespaceSchema } from './turbopuffer-schema';

export interface TurbopufferConfig {
	apiKey: string;
	region: string;
	namespace: string;
	/** Injectable for tests; defaults to the global `fetch`. */
	fetchFn?: typeof fetch;
}

export interface UpsertResult {
	batches: number;
	rowsUpserted: number;
}

const DEFAULT_BATCH_SIZE = 500;
const noop = () => {};

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

/**
 * Batch-upserts documents into the archive's Turbopuffer namespace, creating the namespace and
 * its schema on the first write (per Turbopuffer: a namespace is implicitly created by its first
 * write). `SearchDocument`'s fields already match the namespace schema's attribute names one for
 * one, so each document is sent as a Turbopuffer row as-is — no separate mapping step.
 *
 * Fails loudly on any batch error rather than isolating per-batch failures (unlike per-channel
 * Are.na sync failures): every batch writes to the same namespace, so a failure here is most
 * likely systemic (auth, quota, a schema conflict) rather than specific to one batch's documents.
 * Earlier batches in the same call still committed real, billed writes before a later one failed —
 * `log` reports each batch as it completes so a failure's trail shows exactly how far it got,
 * since idempotent re-upserting the whole set is cheap but "how much of the archive is actually
 * live right now" isn't otherwise visible from a thrown error alone.
 */
export async function upsertSearchDocuments(
	documents: SearchDocument[],
	config: TurbopufferConfig,
	options: { batchSize?: number; log?: (message: string) => void } = {}
): Promise<UpsertResult> {
	const { batchSize = DEFAULT_BATCH_SIZE, log = noop } = options;
	const tpuf = new Turbopuffer({
		apiKey: config.apiKey,
		region: config.region,
		fetch: config.fetchFn
	});
	const namespace = tpuf.namespace(config.namespace);
	const batchesToWrite = chunk(documents, batchSize);

	let rowsUpserted = 0;
	let batches = 0;

	for (const batch of batchesToWrite) {
		const result = await namespace.write({
			schema: archiveNamespaceSchema,
			distance_metric: archiveDistanceMetric,
			upsert_rows: batch
		});
		rowsUpserted += result.rows_affected;
		batches += 1;
		log(`Upserted batch ${batches}/${batchesToWrite.length} (${result.rows_affected} document(s))`);
	}

	return { batches, rowsUpserted };
}
