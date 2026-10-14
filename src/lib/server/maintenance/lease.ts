import { z } from 'zod';
import { getJson, PreconditionFailedError, putJson, type ObjectStore } from './store';

export const LEASE_KEY = 'locks/archive.json';
const leaseSchema = z
	.object({
		holder: z.string().min(1),
		token: z.number().int().positive(),
		expiresAt: z.number().int().nonnegative()
	})
	.strict();

export class LeaseHeldError extends Error {
	constructor(holder: string) {
		super(`Archive maintenance lease is held by ${holder}`);
		this.name = 'LeaseHeldError';
	}
}

export class LeaseLostError extends Error {
	constructor() {
		super('Archive maintenance lease was lost; refusing further canonical writes');
		this.name = 'LeaseLostError';
	}
}

export interface Lease {
	/** Monotonic across every holder; canonical pointers record it so a stale holder cannot overwrite a newer one. */
	token: number;
	holder: string;
	/** Aborted when the lease is lost or released. */
	signal: AbortSignal;
	assertHeld(): void;
	release(): Promise<void>;
}

/**
 * Acquires the archive-wide lease with an atomic conditional write and renews it at a third of its
 * lifetime. Renewal failure aborts `signal`; `assertHeld` also refuses once the local deadline passes,
 * so a paused process cannot keep writing on a lease another holder has already taken over.
 */
export async function acquireLease(
	store: ObjectStore,
	options: {
		holder: string;
		ttlMs?: number;
		now?: () => number;
		renew?: boolean;
		/** A retried attempt may take over its own job's unexpired lease; the new token fences the old attempt. */
		sameHolderTakeover?: boolean;
	}
): Promise<Lease> {
	const { holder, ttlMs = 120_000, now = Date.now, renew = true, sameHolderTakeover } = options;
	const current = await getJson(store, LEASE_KEY, leaseSchema);
	if (
		current &&
		current.value.expiresAt > now() &&
		!(sameHolderTakeover && current.value.holder === holder)
	)
		throw new LeaseHeldError(current.value.holder);
	const token = (current?.value.token ?? 0) + 1;
	let expiresAt = now() + ttlMs;
	let etag: string;
	try {
		etag = await putJson(
			store,
			LEASE_KEY,
			{ holder, token, expiresAt },
			current ? { ifMatch: current.etag } : { ifAbsent: true }
		);
	} catch (error) {
		if (error instanceof PreconditionFailedError) throw new LeaseHeldError('a concurrent holder');
		throw error;
	}
	const controller = new AbortController();
	let timer: ReturnType<typeof setInterval> | undefined;
	let renewing: Promise<void> = Promise.resolve();
	const lose = () => {
		if (timer) clearInterval(timer);
		controller.abort(new LeaseLostError());
	};
	if (renew)
		timer = setInterval(() => {
			renewing = (async () => {
				const nextExpiry = now() + ttlMs;
				try {
					etag = await putJson(
						store,
						LEASE_KEY,
						{ holder, token, expiresAt: nextExpiry },
						{ ifMatch: etag }
					);
					expiresAt = nextExpiry;
				} catch {
					lose();
				}
			})();
		}, ttlMs / 3);
	return {
		token,
		holder,
		signal: controller.signal,
		assertHeld() {
			if (controller.signal.aborted || now() >= expiresAt) throw new LeaseLostError();
		},
		async release() {
			if (timer) clearInterval(timer);
			await renewing;
			if (controller.signal.aborted) return;
			controller.abort(new LeaseLostError());
			await putJson(store, LEASE_KEY, { holder, token, expiresAt: 0 }, { ifMatch: etag }).catch(
				(error: unknown) => {
					if (!(error instanceof PreconditionFailedError)) throw error;
				}
			);
		}
	};
}

const fencedSchema = z.object({ fence: z.number().int().positive() }).passthrough();

/**
 * Replaces a canonical pointer only if this lease is still held, the pointer was not written under
 * a newer lease, and nobody replaced it since `expectedEtag` was read.
 */
export async function fencedPut<T extends object>(
	store: ObjectStore,
	lease: Lease,
	key: string,
	value: T,
	expectedEtag: string | null
) {
	lease.assertHeld();
	const current = await getJson(store, key, fencedSchema);
	if (current && current.value.fence > lease.token) throw new LeaseLostError();
	if ((current?.etag ?? null) !== expectedEtag)
		throw new PreconditionFailedError(`${key} changed during this job`);
	return putJson(
		store,
		key,
		{ ...value, fence: lease.token },
		current ? { ifMatch: current.etag } : { ifAbsent: true }
	);
}
