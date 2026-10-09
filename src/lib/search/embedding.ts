import { z } from 'zod';

export const EMBEDDING = {
	version: 'bge-small-en-v1.5-384-v1',
	model: '@cf/baai/bge-small-en-v1.5',
	dimensions: 384,
	queryPrefix: 'Represent this sentence for searching relevant passages: '
} as const;

export const embeddingVectorSchema = z.array(z.number().finite()).length(EMBEDDING.dimensions);
export const embeddingResponseSchema = z.object({ data: z.array(embeddingVectorSchema) });
export const queryEmbeddingSchema = z.object({
	version: z.literal(EMBEDDING.version),
	vector: embeddingVectorSchema
});

export function normalizeVector(values: readonly number[]): number[] {
	const vector = embeddingVectorSchema.parse(values);
	const norm = Math.hypot(...vector);
	if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid embedding norm');
	return vector.map((value) => value / norm);
}
