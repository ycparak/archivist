import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { renditionUrl } from '../vision/rendition';
import { COLOUR_RENDITION_WIDTH, MAX_FRAMES, measureImageColours } from './extract';

/**
 * Drives the real ffmpeg against generated media, as the transcode suite does: the arguments are
 * the thing worth testing, and a mocked child process would accept any arguments at all.
 */
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.runIf(process.env.CI)('the colour extraction suite', () => {
	it('has ffmpeg, so it is actually running rather than silently skipped', () => {
		expect(hasFfmpeg).toBe(true);
	});
});

/** Media made by ffmpeg on stdout, so no fixture is committed and nothing is written to disk. */
function generate(source: string, format: string, extra: string[] = []): Buffer {
	const made = spawnSync('ffmpeg', [
		'-loglevel',
		'error',
		'-f',
		'lavfi',
		'-i',
		source,
		...extra,
		'-f',
		format,
		'pipe:1'
	]);
	if (made.status !== 0) throw new Error(`could not generate test media: ${made.stderr}`);
	return made.stdout;
}

const solidPng = (colour: string) =>
	generate(`color=c=${colour}:size=40x30`, 'image2pipe', ['-frames:v', '1', '-c:v', 'png']);

function respondWith(body: Uint8Array, init: { status?: number; headers?: HeadersInit } = {}) {
	return vi.fn<typeof fetch>(
		async () => new Response(new Uint8Array(body), { status: init.status ?? 200, ...init })
	);
}

const STILL_URL = 'https://d2w9rnfcy7mm78.cloudfront.net/1/original.png';

describe.runIf(hasFfmpeg)('measureImageColours', () => {
	it('weighs a still from a single frame', async () => {
		const result = await measureImageColours(STILL_URL, {
			fetchFn: respondWith(solidPng('red'))
		});
		expect(result).toMatchObject({ kind: 'measured', frames: 1 });
		if (result.kind !== 'measured') return;
		expect(result.weights.red).toBe(1000);
		expect(result.weights.mono).toBe(0);
	});

	it('reads a black-and-white image as mono', async () => {
		const result = await measureImageColours(STILL_URL, {
			fetchFn: respondWith(solidPng('gray'))
		});
		if (result.kind !== 'measured') throw new Error(`expected a measurement, got ${result.kind}`);
		expect(result.weights.mono).toBe(1000);
		expect(result.weights.grey).toBe(1000);
	});

	it('samples an animation across its frames, once a second', async () => {
		const gif = generate('color=c=blue:size=40x30:rate=10:duration=3', 'gif');
		const result = await measureImageColours(STILL_URL, { fetchFn: respondWith(gif) });
		expect(result).toMatchObject({ kind: 'measured', frames: 3 });
	});

	it('stops sampling a long animation at the frame cap', async () => {
		const gif = generate(`color=c=blue:size=20x20:rate=2:duration=${MAX_FRAMES + 4}`, 'gif');
		const result = await measureImageColours(STILL_URL, { fetchFn: respondWith(gif) });
		expect(result).toMatchObject({ kind: 'measured', frames: MAX_FRAMES });
	});

	it('asks Are.na for a small rendition rather than the original', async () => {
		const payload = { bucket: 'arena', key: 'abc.png', edits: { resize: { width: 1800 } } };
		const url = `https://images.are.na/${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
		const fetchFn = respondWith(solidPng('green'));
		await measureImageColours(url, { fetchFn });
		expect(fetchFn.mock.calls[0][0]).toBe(renditionUrl(url, COLOUR_RENDITION_WIDTH));
	});

	it('skips an unreachable source rather than failing the run', async () => {
		const result = await measureImageColours(STILL_URL, {
			fetchFn: respondWith(new Uint8Array(), { status: 404 })
		});
		expect(result).toEqual({
			kind: 'skipped',
			cause: 'unreachable',
			reason: 'source returned HTTP 404'
		});
	});

	it('skips a source that declares itself over the download limit', async () => {
		const result = await measureImageColours(STILL_URL, {
			fetchFn: respondWith(solidPng('red'), { headers: { 'content-length': '5000000' } }),
			maxSourceBytes: 1000
		});
		expect(result).toMatchObject({ kind: 'skipped', cause: 'too-large' });
	});

	it('stops reading a source that runs past the limit without saying so', async () => {
		const result = await measureImageColours(STILL_URL, {
			fetchFn: respondWith(new Uint8Array(5000)),
			maxSourceBytes: 1000
		});
		expect(result).toMatchObject({ kind: 'skipped', cause: 'too-large' });
	});

	it('surfaces ffmpeg output when the source is not an image', async () => {
		await expect(
			measureImageColours(STILL_URL, {
				fetchFn: respondWith(Buffer.from('this is not an image'))
			})
		).rejects.toThrow(/ffmpeg exited with code/);
	});
});
