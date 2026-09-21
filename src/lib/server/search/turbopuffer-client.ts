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

export interface DeleteResult {
	batches: number;
	rowsDeleted: number;
}

/** Keep below the maintainer account's observed native-embedding batch cap of 256. */
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_DELETE_BATCH_SIZE = 1000;
/** Turbopuffer's maximum `top_k` for a single query. */
const ID_PAGE_SIZE = 10_000;
const noop = () => {};

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

function openNamespace(config: TurbopufferConfig) {
	return new Turbopuffer({
		apiKey: config.apiKey,
		region: config.region,
		fetch: config.fetchFn
	}).namespace(config.namespace);
}

export async function upsertSearchDocuments(
	documents: SearchDocument[],
	config: TurbopufferConfig,
	options: { batchSize?: number; log?: (message: string) => void } = {}
): Promise<UpsertResult> {
	const { batchSize = DEFAULT_BATCH_SIZE, log = noop } = options;
	const namespace = openNamespace(config);
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

/** Pages through every document id in the namespace, without fetching any attributes. */
export async function listDocumentIds(
	config: TurbopufferConfig,
	options: { pageSize?: number } = {}
): Promise<string[]> {
	const { pageSize = ID_PAGE_SIZE } = options;
	const namespace = openNamespace(config);
	const ids: string[] = [];

	for (;;) {
		const last = ids.at(-1);
		const response = await namespace.query({
			rank_by: ['id', 'asc'],
			limit: pageSize,
			include_attributes: false,
			...(last === undefined ? {} : { filters: ['id', 'Gt', last] })
		});
		const rows = response.rows ?? [];
		ids.push(...rows.map((row) => String(row.id)));
		if (rows.length < pageSize) return ids;
	}
}

export async function deleteSearchDocuments(
	ids: string[],
	config: TurbopufferConfig,
	options: { batchSize?: number; log?: (message: string) => void } = {}
): Promise<DeleteResult> {
	const { batchSize = DEFAULT_DELETE_BATCH_SIZE, log = noop } = options;
	const namespace = openNamespace(config);
	const batchesToWrite = chunk(ids, batchSize);

	let rowsDeleted = 0;
	let batches = 0;

	for (const batch of batchesToWrite) {
		const result = await namespace.write({ deletes: batch });
		rowsDeleted += result.rows_affected;
		batches += 1;
		log(`Deleted batch ${batches}/${batchesToWrite.length} (${result.rows_affected} document(s))`);
	}

	return { batches, rowsDeleted };
}
