import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	NoSuchKey,
	PutObjectCommand,
	S3Client,
	S3ServiceException
} from '@aws-sdk/client-s3';
import { z } from 'zod';
import { PreconditionFailedError, type ObjectStore } from './store';

export const r2CredentialsSchema = z.object({
	CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
	MAINTENANCE_R2_BUCKET: z.string().min(3),
	MAINTENANCE_R2_ACCESS_KEY_ID: z.string().min(1),
	MAINTENANCE_R2_SECRET_ACCESS_KEY: z.string().min(1)
});

export function createR2Store(env: Record<string, string | undefined>): ObjectStore {
	const credentials = r2CredentialsSchema.parse(env);
	const bucket = credentials.MAINTENANCE_R2_BUCKET;
	const client = new S3Client({
		region: 'auto',
		endpoint: `https://${credentials.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: credentials.MAINTENANCE_R2_ACCESS_KEY_ID,
			secretAccessKey: credentials.MAINTENANCE_R2_SECRET_ACCESS_KEY
		}
	});
	return {
		async get(key) {
			try {
				const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
				if (!response.Body || !response.ETag) throw new Error(`Incomplete R2 object: ${key}`);
				return { bytes: await response.Body.transformToByteArray(), etag: response.ETag };
			} catch (error) {
				if (error instanceof NoSuchKey) return null;
				throw sanitized(error, key);
			}
		},
		async put(key, bytes, condition) {
			try {
				const response = await client.send(
					new PutObjectCommand({
						Bucket: bucket,
						Key: key,
						Body: bytes,
						IfMatch: condition?.ifMatch,
						IfNoneMatch: condition?.ifAbsent ? '*' : undefined
					})
				);
				if (!response.ETag) throw new Error(`R2 write returned no ETag: ${key}`);
				return response.ETag;
			} catch (error) {
				if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412)
					throw new PreconditionFailedError(key);
				throw sanitized(error, key);
			}
		},
		async list(prefix) {
			const keys: string[] = [];
			let ContinuationToken: string | undefined;
			do {
				const page = await client.send(
					new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken })
				);
				for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
				ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
			} while (ContinuationToken);
			return keys.sort();
		},
		async delete(key) {
			try {
				await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
			} catch (error) {
				throw sanitized(error, key);
			}
		}
	};
}

function sanitized(error: unknown, key: string) {
	const status = error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;
	const name = error instanceof Error ? error.name : 'UnknownError';
	// Network codes such as ECONNRESET are safe to keep; messages may echo signed URLs.
	const code = (error as { code?: unknown } | null)?.code;
	const detail = [name, status, typeof code === 'string' ? code : undefined].filter(Boolean);
	return new Error(`R2 request failed for ${key} (${detail.join(' ')})`);
}
