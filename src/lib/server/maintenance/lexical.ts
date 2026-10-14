import { z } from 'zod';

const shortId = z.string().regex(/^(0|[1-9]\d*)$/);
const lengths = z.tuple([z.number().int().nonnegative()]);
const postings = z.record(shortId, z.number().int().positive());
const lexicalSchema = z
	.object({
		documentCount: z.number().int().positive(),
		nextId: z.number().int().positive(),
		documentIds: z.record(shortId, z.string().min(1)),
		fieldIds: z.object({ search_text: z.literal(0) }).strict(),
		fieldLength: z.record(shortId, lengths),
		averageFieldLength: z.tuple([z.number().finite().nonnegative()]),
		storedFields: z.object({}).strict(),
		dirtCount: z.literal(0),
		index: z.array(z.tuple([z.string().min(1), z.object({ '0': postings }).strict()])),
		serializationVersion: z.literal(2)
	})
	.strict();

export function validateLexical(value: unknown) {
	const data = lexicalSchema.parse(value);
	const ids = Object.keys(data.documentIds);
	if (
		ids.length !== data.documentCount ||
		data.nextId !== data.documentCount ||
		new Set(Object.values(data.documentIds)).size !== ids.length ||
		Object.keys(data.fieldLength).length !== ids.length ||
		ids.some((id) => !data.fieldLength[id] || Number(id) >= data.nextId)
	)
		throw new Error('Lexical document relationships are invalid');
	const terms = new Set<string>();
	const fieldLengths = new Map(ids.map((id) => [id, 0]));
	for (const [term, fields] of data.index) {
		if (terms.has(term)) throw new Error('Duplicate lexical term');
		terms.add(term);
		for (const id of Object.keys(fields['0'])) {
			if (!fieldLengths.has(id)) throw new Error('Lexical term refers to an unknown document');
			fieldLengths.set(id, fieldLengths.get(id)! + 1);
		}
	}
	if (ids.some((id) => data.fieldLength[id][0] < fieldLengths.get(id)!))
		throw new Error('Lexical field lengths do not match terms');
	const average = ids.reduce((sum, id) => sum + data.fieldLength[id][0], 0) / ids.length;
	if (Math.abs(average - data.averageFieldLength[0]) > 1e-8)
		throw new Error('Lexical average field length is invalid');
	return data;
}
