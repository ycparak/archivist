import { describe, expect, it } from 'vitest';
import { resolveSearchConfig } from './config';

const fallback = {
	TURBOPUFFER_API_KEY: 'fallback-key',
	TURBOPUFFER_REGION: 'fallback-region',
	TURBOPUFFER_NAMESPACE: 'fallback-namespace'
};

describe('resolveSearchConfig', () => {
	it('reads credentials from the fallback environment', () => {
		expect(resolveSearchConfig(undefined, fallback)).toEqual({
			apiKey: 'fallback-key',
			region: 'fallback-region',
			namespace: 'fallback-namespace'
		});
	});

	it('prefers platform bindings over the fallback environment', () => {
		expect(
			resolveSearchConfig(
				{
					TURBOPUFFER_API_KEY: 'platform-key',
					TURBOPUFFER_REGION: 'platform-region',
					TURBOPUFFER_NAMESPACE: 'platform-namespace'
				},
				fallback
			)
		).toEqual({
			apiKey: 'platform-key',
			region: 'platform-region',
			namespace: 'platform-namespace'
		});
	});

	it('falls back per value rather than per environment', () => {
		expect(resolveSearchConfig({ TURBOPUFFER_REGION: 'platform-region' }, fallback)).toEqual({
			apiKey: 'fallback-key',
			region: 'platform-region',
			namespace: 'fallback-namespace'
		});
	});

	it('falls back when a platform binding is present but empty', () => {
		expect(
			resolveSearchConfig(
				{ TURBOPUFFER_API_KEY: '', TURBOPUFFER_REGION: '', TURBOPUFFER_NAMESPACE: '' },
				fallback
			)
		).toEqual({
			apiKey: 'fallback-key',
			region: 'fallback-region',
			namespace: 'fallback-namespace'
		});
	});

	it('defaults the namespace when neither environment names one', () => {
		expect(
			resolveSearchConfig(undefined, {
				TURBOPUFFER_API_KEY: 'key',
				TURBOPUFFER_REGION: 'region'
			}).namespace
		).toBe('arena-blocks-v1');
		expect(
			resolveSearchConfig(undefined, { ...fallback, TURBOPUFFER_NAMESPACE: '' }).namespace
		).toBe('arena-blocks-v1');
	});

	it('fails explicitly when a credential is missing or blank', () => {
		expect(() => resolveSearchConfig(undefined, {})).toThrow('Search service is not configured');
		expect(() => resolveSearchConfig(undefined, { TURBOPUFFER_API_KEY: 'key' })).toThrow(
			'Search service is not configured'
		);
		expect(() => resolveSearchConfig(undefined, { ...fallback, TURBOPUFFER_API_KEY: '' })).toThrow(
			'Search service is not configured'
		);
	});
});
