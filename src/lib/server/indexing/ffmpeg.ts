import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 60_000;

export class FfmpegMissingError extends Error {
	constructor(command: string, options?: ErrorOptions) {
		super(
			`Could not run "${command}". The sync uses ffmpeg to read animated blocks and to measure colour — install it (brew install ffmpeg), or pass --no-vision and --no-colour to skip both stages.`,
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

export interface PipeFfmpegOptions extends RunFfmpegOptions {
	/** Written to ffmpeg's stdin, so the source never has to exist as a file. */
	input?: Uint8Array;
	/** Stdout past this is a runaway decode rather than a result; ffmpeg is killed. */
	maxOutputBytes?: number;
}

/** Runs ffmpeg and resolves with whatever it wrote to stdout. */
export function runFfmpeg(args: string[], options: PipeFfmpegOptions = {}): Promise<Buffer> {
	const {
		command = 'ffmpeg',
		timeoutMs = DEFAULT_TIMEOUT_MS,
		signal,
		input,
		maxOutputBytes = Number.POSITIVE_INFINITY
	} = options;

	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			signal,
			stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe']
		});
		const chunks: Buffer[] = [];
		let outputBytes = 0;
		let overflowed = false;
		let stderr = '';

		child.stdout?.on('data', (chunk: Buffer) => {
			outputBytes += chunk.byteLength;
			if (outputBytes > maxOutputBytes) {
				overflowed = true;
				child.kill('SIGKILL');
				return;
			}
			chunks.push(chunk);
		});

		child.stderr?.on('data', (chunk: Buffer) => {
			// Keep only the tail: ffmpeg is verbose and only the last lines explain a failure.
			stderr = (stderr + chunk.toString()).slice(-2000);
		});

		if (input) {
			// ffmpeg can exit before reading all of stdin when the input is not media. That EPIPE is
			// not the failure worth reporting; the exit code and stderr below are.
			child.stdin?.on('error', () => {});
			child.stdin?.end(input);
		}

		const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

		child.on('error', (error: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			reject(error.code === 'ENOENT' ? new FfmpegMissingError(command, { cause: error }) : error);
		});

		child.on('close', (code) => {
			clearTimeout(timer);
			if (overflowed) reject(new Error(`ffmpeg wrote more than ${maxOutputBytes} bytes`));
			else if (code === 0) resolve(Buffer.concat(chunks));
			else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim() || 'no output'}`));
		});
	});
}
