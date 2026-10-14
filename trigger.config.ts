import { ffmpeg } from '@trigger.dev/build/extensions/core';
import { defineConfig } from '@trigger.dev/sdk';

export default defineConfig({
	project: 'proj_yepyanjcjevddergrczr',
	runtime: 'node-24',
	logLevel: 'log',
	maxDuration: 3600,
	retries: {
		enabledInDev: true,
		default: {
			maxAttempts: 3,
			minTimeoutInMs: 1000,
			maxTimeoutInMs: 10000,
			factor: 2,
			randomize: true
		}
	},
	dirs: ['./src/trigger'],
	// Colour measurement decodes images and animations through the shared ffmpeg subprocess.
	build: { extensions: [ffmpeg()] }
});
