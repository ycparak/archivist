import { describe, expect, it, vi } from 'vitest';
import type { SearchDocument } from '$lib/domain/archive';
import {
	deleteSearchDocuments,
	listDocumentIds,
	upsertSearchDocuments
} from './turbopuffer-client';

function document(id: string): SearchDocument {
	return {
		id,
		search_text: `text for ${id}`,
		block_type: 'Text',
		channel_slugs: ['a'],
		connection_count: 1,
		connected_at: '2024-01-01T00:00:00.000Z',
		created_at: '2024-01-01T00:00:00.000Z',
		title: null,
		description: null,
		source_url: null,
		arena_url: `https://www.are.na/block/${id}`,
		image_url: null,
		image_alt: null,
		image_width: null,
		image_height: null,
		source_title: null,
		vision_title: null,
		vision_description: null,
		vision_ocr: null,
		vision_medium: null
	};
}

function okResponse(rowsAffected: number) {
	return new Response(
		JSON.stringify({ status: 'OK', message: 'ok', rows_affected: rowsAffected, billing: {} }),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

describe('upsertSearchDocuments', () => {
	it('does nothing when there are no documents', async () => {
		const fetchFn = vi.fn();

		const result = await upsertSearchDocuments([], {
			apiKey: 'k',
			region: 'r',
			namespace: 'ns',
			fetchFn
		});

		expect(result).toEqual({ batches: 0, rowsUpserted: 0 });
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('writes every document in one batch, with the schema and distance metric, when under the batch size', async () => {
		const fetchFn = vi.fn().mockResolvedValue(okResponse(2));
		const documents = [document('block:1'), document('block:2')];

		const result = await upsertSearchDocuments(documents, {
			apiKey: 'k',
			region: 'r',
			namespace: 'ns',
			fetchFn
		});

		expect(result).toEqual({ batches: 1, rowsUpserted: 2 });
		expect(fetchFn).toHaveBeenCalledTimes(1);

		const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://r.turbopuffer.com/v2/namespaces/ns');
		const body = JSON.parse(init.body as string);
		expect(body.distance_metric).toBe('cosine_distance');
		expect(body.schema.search_text.embed.model).toBe('nvidia/nemotron-3-embed-8b');
		expect(body.upsert_rows).toEqual(documents);
	});

	it('splits documents into multiple batches when exceeding the batch size', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(okResponse(2))
			.mockResolvedValueOnce(okResponse(1));
		const documents = [document('block:1'), document('block:2'), document('block:3')];

		const result = await upsertSearchDocuments(
			documents,
			{ apiKey: 'k', region: 'r', namespace: 'ns', fetchFn },
			{ batchSize: 2 }
		);

		expect(result).toEqual({ batches: 2, rowsUpserted: 3 });
		expect(fetchFn).toHaveBeenCalledTimes(2);

		const firstBody = JSON.parse(
			(fetchFn.mock.calls[0] as [string, RequestInit])[1].body as string
		);
		const secondBody = JSON.parse(
			(fetchFn.mock.calls[1] as [string, RequestInit])[1].body as string
		);
		expect(firstBody.upsert_rows).toHaveLength(2);
		expect(secondBody.upsert_rows).toHaveLength(1);

		expect(secondBody.distance_metric).toBe('cosine_distance');
		expect(secondBody.schema.search_text.embed.model).toBe('nvidia/nemotron-3-embed-8b');
	});

	it('propagates a batch write failure instead of swallowing it, and does not attempt later batches', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(okResponse(2))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
			);
		const documents = [
			document('block:1'),
			document('block:2'),
			document('block:3'),
			document('block:4'),
			document('block:5')
		];

		await expect(
			upsertSearchDocuments(
				documents,
				{ apiKey: 'k', region: 'r', namespace: 'ns', fetchFn },
				{ batchSize: 2 }
			)
		).rejects.toThrow();

		expect(fetchFn).toHaveBeenCalledTimes(2);
		const requestedIds = fetchFn.mock.calls.flatMap(([, init]) =>
			JSON.parse((init as RequestInit).body as string).upsert_rows.map((r: { id: string }) => r.id)
		);
		expect(requestedIds).not.toContain('block:5');
	});
});

describe('listDocumentIds', () => {
	const config = (fetchFn: typeof fetch) => ({
		apiKey: 'k',
		region: 'r',
		namespace: 'ns',
		fetchFn
	});
	const queryResponse = (ids: string[]) =>
		new Response(
			JSON.stringify({ rows: ids.map((id) => ({ id })), billing: {}, performance: {} }),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			}
		);

	it('pages by advancing an id filter, fetching no attributes', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(queryResponse(['a', 'b']))
			.mockResolvedValueOnce(queryResponse(['c']));

		const ids = await listDocumentIds(config(fetchFn as unknown as typeof fetch), { pageSize: 2 });

		expect(ids).toEqual(['a', 'b', 'c']);
		const [first, second] = fetchFn.mock.calls.map(([, init]) =>
			JSON.parse((init as RequestInit).body as string)
		);
		expect(first).toMatchObject({ rank_by: ['id', 'asc'], limit: 2, include_attributes: false });
		expect(first.filters).toBeUndefined();
		expect(second.filters).toEqual(['id', 'Gt', 'b']);
	});

	it('returns an empty list for an empty namespace', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		expect(await listDocumentIds(config(fetchFn as unknown as typeof fetch))).toEqual([]);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});

describe('deleteSearchDocuments', () => {
	it('deletes ids in batches', async () => {
		const fetchFn = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
			const { deletes } = JSON.parse(init.body as string);
			return okResponse(deletes.length);
		});

		const result = await deleteSearchDocuments(
			['a', 'b', 'c'],
			{ apiKey: 'k', region: 'r', namespace: 'ns', fetchFn },
			{ batchSize: 2 }
		);

		expect(result).toEqual({ batches: 2, rowsDeleted: 3 });
		const bodies = fetchFn.mock.calls.map(([, init]) =>
			JSON.parse((init as RequestInit).body as string)
		);
		expect(bodies).toEqual([{ deletes: ['a', 'b'] }, { deletes: ['c'] }]);
	});

	it('does nothing for an empty list', async () => {
		const fetchFn = vi.fn();
		const result = await deleteSearchDocuments([], {
			apiKey: 'k',
			region: 'r',
			namespace: 'ns',
			fetchFn
		});
		expect(result).toEqual({ batches: 0, rowsDeleted: 0 });
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
