import { z } from 'zod';

export const storeKeySchema = z
	.string()
	.regex(/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i, 'Invalid artifact key');

export interface StoredObject {
	bytes: Uint8Array;
	etag: string;
}

export interface PutCondition {
	/** Write only if the object's current ETag matches. */
	ifMatch?: string;
	/** Write only if the object does not exist. */
	ifAbsent?: true;
}

/** The persistence contract hosted maintenance needs; conditional writes must be atomic. */
export interface ObjectStore {
	get(key: string): Promise<StoredObject | null>;
	put(key: string, bytes: Uint8Array, condition?: PutCondition): Promise<string>;
	list(prefix: string): Promise<string[]>;
}

export class PreconditionFailedError extends Error {
	constructor(key: string) {
		super(`Conditional write rejected: ${key}`);
		this.name = 'PreconditionFailedError';
	}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function getJson<T>(store: ObjectStore, key: string, schema: z.ZodType<T>) {
	const object = await store.get(storeKeySchema.parse(key));
	if (!object) return null;
	return { value: schema.parse(JSON.parse(decoder.decode(object.bytes))), etag: object.etag };
}

export function putJson(store: ObjectStore, key: string, value: unknown, condition?: PutCondition) {
	return store.put(storeKeySchema.parse(key), encoder.encode(JSON.stringify(value)), condition);
}

/**
 * Immutable artifacts are content-addressed or uniquely keyed, so an existing object with the same
 * bytes is the same artifact (a retried write), and different bytes are a contract violation.
 */
export async function putImmutable(store: ObjectStore, key: string, bytes: Uint8Array) {
	try {
		await store.put(storeKeySchema.parse(key), bytes, { ifAbsent: true });
	} catch (error) {
		if (!(error instanceof PreconditionFailedError)) throw error;
		const existing = await store.get(key);
		if (!existing || !sameBytes(existing.bytes, bytes))
			throw new Error(`Immutable artifact differs: ${key}`, { cause: error });
	}
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
	return a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);
}

export function memoryStore(): ObjectStore & { objects: Map<string, StoredObject> } {
	const objects = new Map<string, StoredObject>();
	let revision = 0;
	return {
		objects,
		async get(key) {
			const object = objects.get(key);
			return object ? { bytes: object.bytes.slice(), etag: object.etag } : null;
		},
		async put(key, bytes, condition) {
			const current = objects.get(key);
			if (condition?.ifAbsent && current) throw new PreconditionFailedError(key);
			if (condition?.ifMatch !== undefined && current?.etag !== condition.ifMatch)
				throw new PreconditionFailedError(key);
			const etag = `"${++revision}"`;
			objects.set(key, { bytes: bytes.slice(), etag });
			return etag;
		},
		async list(prefix) {
			return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
		}
	};
}
