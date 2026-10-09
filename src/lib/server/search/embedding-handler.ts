import { z } from 'zod';
import { EMBEDDING, embeddingResponseSchema, normalizeVector } from '$lib/search/embedding';

const requestSchema = z
	.object({
		query: z.string().trim().min(1).max(400),
		version: z.literal(EMBEDDING.version)
	})
	.strict();
const headers = { 'cache-control': 'no-store' };

export async function handleEmbeddingRequest(
	request: Request,
	embed: ((text: string) => Promise<unknown>) | undefined
): Promise<Response> {
	if (!request.headers.get('content-type')?.startsWith('application/json'))
		return Response.json({ error: 'Expected JSON' }, { status: 415, headers });
	let body: unknown;
	try {
		if (!request.body) throw new Error('Missing body');
		const reader = request.body.getReader();
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				bytes += value.length;
				if (bytes > 4096) {
					await reader.cancel();
					return Response.json({ error: 'Request too large' }, { status: 413, headers });
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		const buffer = new Uint8Array(bytes);
		let offset = 0;
		for (const chunk of chunks) {
			buffer.set(chunk, offset);
			offset += chunk.length;
		}
		body = JSON.parse(new TextDecoder().decode(buffer));
	} catch {
		return Response.json({ error: 'Invalid request' }, { status: 400, headers });
	}
	const parsed = requestSchema.safeParse(body);
	if (!parsed.success)
		return Response.json(
			{ error: 'Invalid query or unsupported embedding version; reload the archive' },
			{ status: 400, headers }
		);
	if (!embed)
		return Response.json({ error: 'Semantic search is not configured' }, { status: 503, headers });
	try {
		const response = embeddingResponseSchema.parse(
			await embed(EMBEDDING.queryPrefix + parsed.data.query)
		);
		if (response.data.length !== 1) throw new Error('Unexpected query embedding count');
		return Response.json(
			{ version: EMBEDDING.version, vector: normalizeVector(response.data[0]) },
			{ headers }
		);
	} catch {
		const correlationId = crypto.randomUUID();
		console.error({ event: 'archive_embedding_unavailable', correlationId });
		return Response.json(
			{ error: 'Semantic search is unavailable', correlationId },
			{ status: 503, headers }
		);
	}
}
