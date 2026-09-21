import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Are.na stores animated GIFs on a CDN that publishes no smaller rendition — `thumb`, `square`,
 * `small`, `medium` and `large` are all the same original — so the image path had to skip anything
 * over the provider's 5 MB ceiling, and described the rest from a single frame.
 *
 * Transcoding locally fixes both. A 24.2 MB GIF becomes a 145 KB MP4 in half a second, and the
 * model reads it as motion rather than a still: "a man running in a park while various data metrics
 * dynamically appear and update" is not something one frame can say.
 */

export const VIDEO_MEDIA_TYPE = 'video/mp4';

/** Enough detail for the model, small enough to inline as a data URL. */
const TARGET_WIDTH = 512;
const TARGET_FPS = 6;
const TARGET_CRF = 32;

/** Well above the 145 KB a 24 MB source produced, but a bound rather than a hope. */
export const MAX_TRANSCODED_BYTES = 4 * 1024 * 1024;
/** A GIF this large is a download problem before it is a transcode problem. */
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 60_000;

export class FfmpegMissingError extends Error {
	constructor(command: string, options?: ErrorOptions) {
		super(
			`Could not run "${command}". Animated blocks are transcoded locally before being described, which needs ffmpeg on PATH — install it (brew install ffmpeg) or pass --no-vision-video to describe them from a single frame instead.`,
			options
		);
		this.name = 'FfmpegMissingError';
	}
}

export interface RunFfmpegOptions {
	command?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}

function runFfmpeg(args: string[], options: RunFfmpegOptions = {}): Promise<void> {
	const { command = 'ffmpeg', timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;

	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { signal });
		let stderr = '';

		child.stderr?.on('data', (chunk: Buffer) => {
			// Keep only the tail: ffmpeg is verbose and only the last lines explain a failure.
			stderr = (stderr + chunk.toString()).slice(-2000);
		});

		const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

		child.on('error', (error: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			reject(error.code === 'ENOENT' ? new FfmpegMissingError(command, { cause: error }) : error);
		});

		child.on('close', (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim() || 'no output'}`));
		});
	});
}

export type TranscodeResult =
	{ kind: 'video'; dataUrl: string; bytes: number } | { kind: 'skipped'; reason: string };

export interface TranscodeOptions extends RunFfmpegOptions {
	fetchFn?: typeof fetch;
	maxSourceBytes?: number;
	maxTranscodedBytes?: number;
}

/**
 * Downloads an animated source, transcodes it to a small MP4, and returns it as a data URL — the
 * provider cannot fetch a file that only exists on this machine, so the bytes ride along inline.
 */
export async function transcodeToVideoDataUrl(
	url: string,
	options: TranscodeOptions = {}
): Promise<TranscodeResult> {
	const {
		fetchFn = fetch,
		maxSourceBytes = MAX_SOURCE_BYTES,
		maxTranscodedBytes = MAX_TRANSCODED_BYTES,
		...ffmpegOptions
	} = options;

	const response = await fetchFn(url, { headers: { 'User-Agent': 'archivist' } });
	if (!response.ok) {
		return { kind: 'skipped', reason: `source returned HTTP ${response.status}` };
	}

	const source = Buffer.from(await response.arrayBuffer());
	if (source.byteLength > maxSourceBytes) {
		return {
			kind: 'skipped',
			reason: `source is ${(source.byteLength / 1024 / 1024).toFixed(1)}MB, over the ${maxSourceBytes / 1024 / 1024}MB download limit`
		};
	}

	const directory = await mkdtemp(join(tmpdir(), 'archivist-vision-'));
	try {
		const input = join(directory, 'source');
		const output = join(directory, 'out.mp4');
		await writeFile(input, source);

		await runFfmpeg(
			[
				'-y',
				'-loglevel',
				'error',
				'-i',
				input,
				'-movflags',
				'+faststart',
				'-pix_fmt',
				'yuv420p',
				'-vf',
				`scale='min(${TARGET_WIDTH},iw)':-2:flags=lanczos,fps=${TARGET_FPS}`,
				'-c:v',
				'libx264',
				'-crf',
				String(TARGET_CRF),
				// The archive's animations are silent and audio is out of scope either way.
				'-an',
				output
			],
			ffmpegOptions
		);

		const encoded = await readFile(output);
		if (encoded.byteLength > maxTranscodedBytes) {
			return {
				kind: 'skipped',
				reason: `transcoded to ${(encoded.byteLength / 1024 / 1024).toFixed(1)}MB, over the ${maxTranscodedBytes / 1024 / 1024}MB inline limit`
			};
		}

		return {
			kind: 'video',
			dataUrl: `data:${VIDEO_MEDIA_TYPE};base64,${encoded.toString('base64')}`,
			bytes: encoded.byteLength
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

/**
 * Whether a block should be read as motion. Keyed off the content type Are.na reports rather than
 * the URL, since the CDN path carries no reliable extension.
 */
export function isAnimated(contentType: string | null | undefined): boolean {
	return contentType?.toLowerCase().trim() === 'image/gif';
}
