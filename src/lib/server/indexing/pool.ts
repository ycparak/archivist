/** Bounded fan-out over one shared cursor, so a slow block never stalls the others. */
export async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
	let cursor = 0;
	const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
		for (;;) {
			const index = cursor++;
			if (index >= items.length) return;
			await worker(items[index]);
		}
	});
	await Promise.all(runners);
}
