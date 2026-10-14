export const DOWNLOAD_TIMEOUT_MS = 60_000;

export type CappedDownload =
	| { kind: 'ok'; bytes: Uint8Array }
	| { kind: 'unreachable'; reason: string }
	| { kind: 'too-large'; reason: string };

export interface CappedDownloadOptions {
	fetchFn?: typeof fetch;
	maxBytes: number;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/**
 * Downloads at most `maxBytes`. A declared length over the cap is refused before the body is read,
 * an undeclared one is cut off as soon as it passes the cap, and the timeout and caller's signal
 * cover the whole body, not just the headers — so neither a huge nor a stalled source can hold
 * memory or a worker.
 */
export async function downloadCapped(
	url: string,
	options: CappedDownloadOptions
): Promise<CappedDownload> {
	const { fetchFn = fetch, maxBytes, signal, timeoutMs = DOWNLOAD_TIMEOUT_MS } = options;
	const timeout = AbortSignal.timeout(timeoutMs);
	const response = await fetchFn(url, {
		headers: { 'User-Agent': 'archivist' },
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout
	});
	if (!response.ok) {
		await response.body?.cancel();
		return { kind: 'unreachable', reason: `source returned HTTP ${response.status}` };
	}
	const tooLarge = {
		kind: 'too-large',
		reason: `source is over the ${maxBytes / 1024 / 1024}MB download limit`
	} as const;
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) {
		await response.body?.cancel();
		return tooLarge;
	}
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		return bytes.byteLength > maxBytes ? tooLarge : { kind: 'ok', bytes };
	}

	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = response.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			return tooLarge;
		}
		chunks.push(value);
	}
	return { kind: 'ok', bytes: Buffer.concat(chunks) };
}
