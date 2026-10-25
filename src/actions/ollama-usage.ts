import { getJson } from "./ollama-api";

/** Per-request token and cost metrics; every field is required by the usage API. */
export type UsageMetrics = {
	request_count: number;
	usage_usd: number;
	/** Input tokens, including cached ones (cached_input_tokens is a subset). */
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
};

/** One time bucket of usage; the current in-progress hour carries `partial: true`. */
export type UsageMetricsBucket = UsageMetrics & { from: string; until: string; partial: boolean };

/** Response of GET /api/usage?range=24h (docs.ollama.com/api/cloud-usage). */
export type UsageResponse = {
	range: string;
	scope: string;
	granularity: string;
	from: string;
	until: string;
	totals: UsageMetrics & { groups?: unknown[]; remainder?: UsageMetrics };
	buckets: UsageMetricsBucket[];
};

/**
 * Fetches cloud usage for the rolling 24h window (hourly buckets).
 * @param apiKey The API key; the endpoint shares a 10 req/min budget with /api/balance.
 * @returns The parsed usage response.
 */
export async function getUsage(apiKey: string): Promise<UsageResponse> {
	return getJson("/api/usage?range=24h", apiKey) as Promise<UsageResponse>;
}

/**
 * Tokens the grove counts from a metrics set: input + output. Cached input is
 * already part of input_tokens and still represents AI activity, so it is not subtracted.
 * @param metrics The metrics to count.
 * @returns The token count.
 */
export function bucketTokens(metrics: UsageMetrics): number {
	return metrics.input_tokens + metrics.output_tokens;
}

/**
 * Token delta since the last poll, tracked per bucket (`bucket.from`). Completed
 * buckets are immutable per the API contract, so deltas only grow; tracking per
 * bucket instead of totals makes the delta immune to the 24h window sliding.
 * @param seen Last-seen token counts per bucket, or undefined on first poll.
 * @param response The current usage response.
 * @returns The token delta and the new last-seen map (slid-off buckets pruned).
 */
export function ollamaTokensDelta(seen: Record<string, number> | undefined, response: UsageResponse): { delta: number; buckets: Record<string, number> } {
	let delta = 0;
	const buckets: Record<string, number> = {};
	for (const bucket of response.buckets) {
		const tokens = bucketTokens(bucket);
		buckets[bucket.from] = tokens;
		delta += Math.max(0, tokens - (seen?.[bucket.from] ?? 0));
	}
	return { delta, buckets };
}