import { mkdir, rm } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

export async function withFileLock<T>(
	directory: URL,
	action: () => Promise<T>,
	attempts = 1
): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			await mkdir(directory);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			if (attempt + 1 >= attempts)
				throw new Error('Search publication is locked by another writer', { cause: error });
			await setTimeout(25);
		}
	}
	try {
		return await action();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
