import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FfmpegMissingError, runFfmpeg } from './ffmpeg';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('runFfmpeg', () => {
	it('names ffmpeg and how to install it when the binary is missing', async () => {
		const error = await runFfmpeg(['-version'], { command: 'ffmpeg-that-does-not-exist' }).catch(
			(caught: unknown) => caught
		);
		expect(error).toBeInstanceOf(FfmpegMissingError);
		expect((error as Error).message).toMatch(/brew install ffmpeg/);
	});

	it.runIf(hasFfmpeg)('pipes stdin through and resolves with stdout', async () => {
		const input = Buffer.from([10, 20, 30, 40, 50, 60]);
		const output = await runFfmpeg(
			[
				'-loglevel',
				'error',
				'-f',
				'rawvideo',
				'-pix_fmt',
				'rgb24',
				'-s',
				'2x1',
				'-i',
				'pipe:0',
				'-f',
				'rawvideo',
				'-pix_fmt',
				'rgb24',
				'pipe:1'
			],
			{ input }
		);
		expect([...output]).toEqual([...input]);
	});

	it.runIf(hasFfmpeg)('kills a decode that writes more than it is allowed to', async () => {
		await expect(
			runFfmpeg(
				[
					'-loglevel',
					'error',
					'-f',
					'lavfi',
					'-i',
					'color=c=red:size=64x64:rate=10:duration=5',
					'-f',
					'rawvideo',
					'pipe:1'
				],
				{ maxOutputBytes: 1024 }
			)
		).rejects.toThrow(/more than 1024 bytes/);
	});

	it.runIf(hasFfmpeg)('reports the exit code and stderr when the input is not media', async () => {
		await expect(
			runFfmpeg(['-loglevel', 'error', '-i', 'pipe:0', '-f', 'rawvideo', 'pipe:1'], {
				input: Buffer.from('not media')
			})
		).rejects.toThrow(/ffmpeg exited with code/);
	});

	const endless = [
		'-loglevel',
		'error',
		'-re',
		'-f',
		'lavfi',
		'-i',
		'color=c=red:size=16x16:rate=5:duration=30',
		'-f',
		'null',
		'-'
	];

	it.runIf(hasFfmpeg)('kills and reports a decode that runs past its timeout', async () => {
		await expect(runFfmpeg(endless, { timeoutMs: 300 })).rejects.toThrow(/timed out after 300ms/);
	});

	it.runIf(hasFfmpeg)('stops ffmpeg when the caller cancels', async () => {
		const abort = new AbortController();
		const running = runFfmpeg(endless, { signal: abort.signal });
		setTimeout(() => abort.abort(), 100);
		await expect(running).rejects.toThrow(/abort/i);
	});
});
