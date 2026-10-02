const ARCHIVE_SIZE_TTL_MS = 10 * 60_000;

/**
 * Remembers the archive's block count for a while, so the footer costs one count query per isolate
 * every ten minutes rather than one per page view. Concurrent callers share one request, and a failed
 * one is forgotten so the next caller tries again.
 */
export function createArchiveSizeCache(ttlMs = ARCHIVE_SIZE_TTL_MS, now = () => Date.now()) {
	let cached: { value: Promise<number>; expiresAt: number } | undefined;
	return (load: () => Promise<number>): Promise<number> => {
		const time = now();
		if (cached && cached.expiresAt > time) return cached.value;
		const value = load();
		const entry = { value, expiresAt: time + ttlMs };
		cached = entry;
		value.catch(() => {
			if (cached === entry) cached = undefined;
		});
		return value;
	};
}
