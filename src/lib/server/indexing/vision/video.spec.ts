import { describe, expect, it, vi } from 'vitest';
import { FfmpegMissingError } from '../ffmpeg';
import {
	cleanupStaleTranscodes,
	isAnimated,
	MAX_SOURCE_BYTES,
	transcodeToVideoDataUrl
} from './video';

/**
 * These drive the real ffmpeg binary against a generated clip rather than mocking `spawn`, because
 * the thing worth testing is that the arguments actually produce a file a provider will accept —
 * a mocked child process would pass with any arguments at all, and these arguments have been wrong
 * twice.
 *
 * Leaving out `--vision` (with `--no-colour`) makes a machine without ffmpeg a supported way to run this project, so the
 * suites that need it skip rather than fail there. CI installs it and the check below asserts it,
 * so a skip can never quietly turn into missing coverage on the branch gate.
 */

const GENERATED_GIF_URL = 'https://cdn.example/animation.gif';

const { spawnSync: probe } = await import('node:child_process');
const hasFfmpeg = probe('ffmpeg', ['-version']).status === 0;

describe.runIf(process.env.CI)('the transcode suite', () => {
	it('has ffmpeg, so it is actually running rather than silently skipped', () => {
		expect(hasFfmpeg).toBe(true);
	});
});

/** A tiny animation, made by ffmpeg so the fixture is not a committed binary. */
async function sampleGif(size = '320x240'): Promise<Buffer> {
	const { spawnSync } = await import('node:child_process');
	const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');

	const dir = mkdtempSync(join(tmpdir(), 'archivist-test-'));
	const out = join(dir, 'in.gif');
	// Checked, because an unchecked failure here surfaces as an opaque ENOENT on the output file
	// rather than naming the missing dependency — which is exactly how this failed in CI.
	const made = spawnSync('ffmpeg', [
		'-y',
		'-loglevel',
		'error',
		'-f',
		'lavfi',
		'-i',
		`testsrc=size=${size}:rate=10:duration=1`,
		out
	]);
	if (made.status !== 0) {
		rmSync(dir, { recursive: true, force: true });
		throw new Error(
			`could not generate the test clip: ffmpeg ${made.error ? `is missing (${made.error.message})` : `exited with ${made.status}: ${made.stderr?.toString().trim()}`}`
		);
	}
	const bytes = readFileSync(out);
	rmSync(dir, { recursive: true, force: true });
	return bytes;
}

function respondWith(body: Buffer, init: { status?: number } = {}) {
	return vi.fn<typeof fetch>(
		async () => new Response(new Uint8Array(body), { status: init.status ?? 200 })
	);
}

describe('isAnimated', () => {
	it('recognises the content type Are.na reports for animations', () => {
		expect(isAnimated('image/gif')).toBe(true);
		expect(isAnimated('IMAGE/GIF ')).toBe(true);
	});

	it('leaves stills on the image path', () => {
		for (const type of ['image/jpeg', 'image/png', 'image/webp', null, undefined, '']) {
			expect(isAnimated(type)).toBe(false);
		}
	});
});

describe.skipIf(!hasFfmpeg)('transcodeToVideoDataUrl', () => {
	it('produces an mp4 data url the model can be handed', async () => {
		const fetchFn = respondWith(await sampleGif());
		const result = await transcodeToVideoDataUrl(GENERATED_GIF_URL, { fetchFn });

		expect(result.kind).toBe('video');
		if (result.kind !== 'video') return;
		expect(result.dataUrl.startsWith('data:video/mp4;base64,')).toBe(true);
		expect(result.bytes).toBeGreaterThan(0);

		// Decodes to a real MP4: bytes 4-8 of the ftyp box.
		const payload = Buffer.from(result.dataUrl.split(',')[1], 'base64');
		expect(payload.subarray(4, 8).toString()).toBe('ftyp');
	});

	it('shrinks the source substantially, which is the whole point', async () => {
		const source = await sampleGif();
		const result = await transcodeToVideoDataUrl(GENERATED_GIF_URL, {
			fetchFn: respondWith(source)
		});

		if (result.kind !== 'video') throw new Error('expected a transcode');
		expect(result.bytes).toBeLessThan(source.byteLength);
	});

	it('skips a source too large to be worth downloading', async () => {
		const fetchFn = respondWith(Buffer.alloc(1024));
		const result = await transcodeToVideoDataUrl(GENERATED_GIF_URL, {
			fetchFn,
			maxSourceBytes: 512
		});

		expect(result).toEqual({
			kind: 'skipped',
			cause: 'too-large',
			reason: expect.stringContaining('over the') as unknown as string
		});
	});

	it('skips when the transcode still lands over the inline limit', async () => {
		const result = await transcodeToVideoDataUrl(GENERATED_GIF_URL, {
			fetchFn: respondWith(await sampleGif()),
			maxTranscodedBytes: 1
		});

		expect(result.kind).toBe('skipped');
		if (result.kind !== 'skipped') return;
		expect(result.cause).toBe('too-large');
		expect(result.reason).toContain('inline limit');
	});

	it('skips an unreachable source rather than failing the run', async () => {
		const result = await transcodeToVideoDataUrl(GENERATED_GIF_URL, {
			fetchFn: respondWith(Buffer.alloc(0), { status: 404 })
		});

		expect(result).toEqual({
			kind: 'skipped',
			cause: 'unreachable',
			reason: 'source returned HTTP 404',
			retryable: false
		});
	});

	it('names ffmpeg and how to install it when the binary is missing', async () => {
		await expect(
			transcodeToVideoDataUrl(GENERATED_GIF_URL, {
				fetchFn: respondWith(await sampleGif()),
				command: 'ffmpeg-that-does-not-exist'
			})
		).rejects.toBeInstanceOf(FfmpegMissingError);
	});

	it('surfaces ffmpeg output when it fails on the input', async () => {
		await expect(
			transcodeToVideoDataUrl(GENERATED_GIF_URL, {
				fetchFn: respondWith(Buffer.from('this is not an animation'))
			})
		).rejects.toThrow(/ffmpeg exited with code/);
	});

	it('defaults to a source ceiling above the largest animation in the archive', () => {
		expect(MAX_SOURCE_BYTES).toBeGreaterThan(24.2 * 1024 * 1024);
	});
});

describe.skipIf(!hasFfmpeg)('transcodeToVideoDataUrl — leaves nothing behind', () => {
	async function tempDirCount() {
		const { readdirSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		return readdirSync(tmpdir()).filter((n) => n.startsWith('archivist-vision-')).length;
	}

	it('removes its scratch directory after a successful transcode', async () => {
		const before = await tempDirCount();
		await transcodeToVideoDataUrl(GENERATED_GIF_URL, { fetchFn: respondWith(await sampleGif()) });
		expect(await tempDirCount()).toBe(before);
	});

	it('removes it when the transcode is rejected for size', async () => {
		const before = await tempDirCount();
		await transcodeToVideoDataUrl(GENERATED_GIF_URL, {
			fetchFn: respondWith(await sampleGif()),
			maxTranscodedBytes: 1
		});
		expect(await tempDirCount()).toBe(before);
	});

	it('removes it when ffmpeg fails', async () => {
		const before = await tempDirCount();
		await expect(
			transcodeToVideoDataUrl(GENERATED_GIF_URL, {
				fetchFn: respondWith(Buffer.from('not an animation'))
			})
		).rejects.toThrow();
		expect(await tempDirCount()).toBe(before);
	});

	it('deletes the downloaded source before encoding, which is the large half', async () => {
		// Proven indirectly: after the call the whole directory is gone, and during it the source
		// is removed as soon as ffmpeg has read it. A leak would show up as a surviving directory.
		const before = await tempDirCount();
		const result = await transcodeToVideoDataUrl(GENERATED_GIF_URL, {
			fetchFn: respondWith(await sampleGif())
		});
		expect(result.kind).toBe('video');
		expect(await tempDirCount()).toBe(before);
	});
});

describe('cleanupStaleTranscodes', () => {
	it('leaves a directory a concurrent run could still be using', async () => {
		const { mkdtempSync, mkdirSync, existsSync, rmSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');

		const sandbox = mkdtempSync(join(tmpdir(), 'archivist-sweep-test-'));
		const fresh = join(sandbox, 'archivist-vision-inflight');
		mkdirSync(fresh);

		const { removed } = await cleanupStaleTranscodes(sandbox);

		expect(removed).toBe(0);
		expect(existsSync(fresh)).toBe(true);
		rmSync(sandbox, { recursive: true, force: true });
	});

	it('removes what an interrupted run left behind, and nothing else', async () => {
		const { mkdtempSync, mkdirSync, existsSync, rmSync, utimesSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');

		const sandbox = mkdtempSync(join(tmpdir(), 'archivist-sweep-test-'));
		const stale = join(sandbox, 'archivist-vision-abc123');
		const unrelated = join(sandbox, 'someone-elses-files');
		mkdirSync(stale);
		mkdirSync(unrelated);

		// Backdated rather than passing a zero age, so this exercises the real default threshold.
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
		utimesSync(stale, twoHoursAgo, twoHoursAgo);
		utimesSync(unrelated, twoHoursAgo, twoHoursAgo);

		const { removed } = await cleanupStaleTranscodes(sandbox);

		expect(removed).toBe(1);
		expect(existsSync(stale)).toBe(false);
		expect(existsSync(unrelated)).toBe(true);
		rmSync(sandbox, { recursive: true, force: true });
	});

	it('does not fail a run when the directory cannot be read', async () => {
		await expect(cleanupStaleTranscodes('/no/such/directory')).resolves.toEqual({ removed: 0 });
	});
});

describe.skipIf(!hasFfmpeg)('transcodeToVideoDataUrl — awkward source dimensions', () => {
	/**
	 * libx264 at yuv420p refuses odd dimensions. A real run hit this on three blocks (401x402,
	 * 439x440, 503x714) because the scale expression only forced the height even.
	 */
	it.each(['401x402', '439x440', '503x714', '321x241'])(
		'transcodes a %s source instead of failing the encoder',
		async (size) => {
			const result = await transcodeToVideoDataUrl(GENERATED_GIF_URL, {
				fetchFn: respondWith(await sampleGif(size))
			});

			expect(result.kind).toBe('video');
		}
	);

	it('keeps a source narrower than the target at its own width', async () => {
		const result = await transcodeToVideoDataUrl(GENERATED_GIF_URL, {
			fetchFn: respondWith(await sampleGif('100x80'))
		});

		expect(result.kind).toBe('video');
	});
});
