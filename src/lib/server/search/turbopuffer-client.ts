import Turbopuffer from '@turbopuffer/turbopuffer';
import type { SearchDocument } from '$lib/domain/archive';
import { archiveDistanceMetric, archiveNamespaceSchema } from './turbopuffer-schema';

export interface TurbopufferConfig {
	apiKey: string;
	region: string;
	namespace: string;
	fetchFn?: typeof fetch;
}

export interface UpsertResult {
	batches: number;
	rowsUpserted: number;
}

/** Keep below the maintainer account's observed native-embedding batch cap of 256. */
const DEFAULT_BATCH_SIZE = 200;
const noop = () => {};

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

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
