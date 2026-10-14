import { downloadCapped } from '../download';
import { isRetryableStatus } from '../outcome';
import { runFfmpeg, type PipeFfmpegOptions } from '../ffmpeg';
import { renditionUrl } from '../vision/rendition';
import { MAX_SOURCE_BYTES } from '../vision/video';
import { weighColours, type ColourWeights } from './classify';

/**
 * Colour share needs no detail: 64 × 64 is 4,096 samples, and the 128px rendition it is scaled from
 * is a few kilobytes. Neither the download nor the raster is ever written to disk.
 */
export const RASTER_SIZE = 64;
export const COLOUR_RENDITION_WIDTH = 128;
/** An animation is sampled once a second, from its first frame, up to this many frames. */
export const MAX_FRAMES = 8;

const BYTES_PER_PIXEL = 4;
const FRAME_BYTES = RASTER_SIZE * RASTER_SIZE * BYTES_PER_PIXEL;

export type MeasureResult =
	| { kind: 'measured'; weights: ColourWeights; frames: number }
	| { kind: 'skipped'; cause: 'unreachable' | 'too-large'; reason: string; retryable?: boolean };

export interface MeasureOptions extends Omit<PipeFfmpegOptions, 'input' | 'maxOutputBytes'> {
	fetchFn?: typeof fetch;
	maxSourceBytes?: number;
}

/** The ffmpeg arguments that turn whatever arrives on stdin into RGBA frames on stdout. */
export const RASTER_ARGS = [
	'-loglevel',
	'error',
	'-i',
	'pipe:0',
	'-vf',
	// `fps` drops the only frame of a still read from a pipe; this keeps the first frame and then one
	// per second, which serves stills and animations alike.
	`select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,1)',scale=${RASTER_SIZE}:${RASTER_SIZE}:flags=area`,
	'-fps_mode',
	'passthrough',
	'-frames:v',
	String(MAX_FRAMES),
	'-f',
	'rawvideo',
	'-pix_fmt',
	'rgba',
	'pipe:1'
];

/**
 * Measures how much of an image is each colour. A still is fetched as a small Are.na rendition; an
 * animation on the CDN has no rendition, so its original is fetched and sampled across frames.
 */
export async function measureImageColours(
	url: string,
	options: MeasureOptions = {}
): Promise<MeasureResult> {
	const { fetchFn = fetch, maxSourceBytes = MAX_SOURCE_BYTES, signal, ...ffmpegOptions } = options;
	const download = await downloadCapped(renditionUrl(url, COLOUR_RENDITION_WIDTH), {
		fetchFn,
		maxBytes: maxSourceBytes,
		signal
	});
	if (download.kind === 'unreachable')
		return {
			kind: 'skipped',
			cause: 'unreachable',
			reason: download.reason,
			retryable: isRetryableStatus(download.status)
		};
	if (download.kind === 'too-large')
		return { kind: 'skipped', cause: 'too-large', reason: download.reason };
	const source = download.bytes;

	const raster = await runFfmpeg(RASTER_ARGS, {
		...ffmpegOptions,
		signal,
		input: source,
		maxOutputBytes: FRAME_BYTES * MAX_FRAMES
	});
	if (raster.byteLength === 0 || raster.byteLength % FRAME_BYTES !== 0) {
		throw new Error(
			`ffmpeg returned ${raster.byteLength} bytes, not whole ${RASTER_SIZE}px frames`
		);
	}

	return {
		kind: 'measured',
		weights: weighColours(raster),
		frames: raster.byteLength / FRAME_BYTES
	};
}
