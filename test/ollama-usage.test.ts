import { afterEach, describe, expect, it, vi } from "vitest";

import { OllamaApiError } from "../src/actions/ollama-api";
import { bucketTokens, getUsage, ollamaTokensDelta, type UsageMetrics, type UsageResponse } from "../src/actions/ollama-usage";

afterEach(() => {
	vi.unstubAllGlobals();
});

function usageResponse(buckets: Array<Partial<UsageResponse["buckets"][number]>>): UsageResponse {
	return {
		range: "24h",
		scope: "self",
		granularity: "hour",
		from: "2026-10-24T20:00:00Z",
		until: "2026-10-25T20:00:00Z",
		totals: metrics(0),
		buckets: buckets.map((b) => ({
			from: "1970-01-01T00:00:00Z",
			until: "1970-01-01T01:00:00Z",
			partial: false,
			request_count: 0,
			usage_usd: 0,
			input_tokens: 0,
			cached_input_tokens: 0,
			output_tokens: 0,
			...b,
		})),
	};
}

function metrics(input: number, output: number, cached = 0): UsageMetrics {
	return { request_count: 1, usage_usd: 0.01, input_tokens: input, cached_input_tokens: cached, output_tokens: output };
}

describe("getUsage", () => {
	it("calls /api/usage?range=24h with bearer auth", async () => {
		const mock = vi.fn(async () => new Response(JSON.stringify(usageResponse([])), { status: 200 }));
		vi.stubGlobal("fetch", mock);

		await getUsage("secret-key");

		expect(mock).toHaveBeenCalledTimes(1);
		const [url, init] = mock.mock.calls[0];
		expect(url).toBe("https://ollama.com/api/usage?range=24h");
		expect((init as RequestInit).headers).toEqual({ Authorization: "Bearer secret-key" });
	});

	it("throws OllamaApiError with retry seconds on 429", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers: { "Retry-After": "7" } })),
		);

		const error = await getUsage("secret-key").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(OllamaApiError);
		expect((error as OllamaApiError).status).toBe(429);
		expect((error as OllamaApiError).retryAfterSeconds).toBe(7);
	});
});

describe("bucketTokens", () => {
	it("counts input plus output tokens, cached included in input", () => {
		// Cached tokens are already a subset of input_tokens — the grove counts all AI activity.
		expect(bucketTokens(metrics(1000, 200, 800))).toBe(1200);
	});
});

describe("ollamaTokensDelta", () => {
	it("counts growth of a partial bucket seen before", () => {
		const before = usageResponse([{ from: "2026-10-25T19:00:00Z", partial: true, ...metrics(100, 20) }]);
		const after = usageResponse([{ from: "2026-10-25T19:00:00Z", partial: true, ...metrics(350, 60) }]);

		const result = ollamaTokensDelta(ollamaTokensDelta(undefined, before).buckets, after);
		expect(result.delta).toBe(290); // (350+60) - (100+20)
		expect(result.buckets["2026-10-25T19:00:00Z"]).toBe(410);
	});

	it("counts a newly completed bucket in full, exactly once", () => {
		const before = usageResponse([{ from: "2026-10-25T19:00:00Z", partial: true, ...metrics(100, 20) }]);
		const after = usageResponse([
			{ from: "2026-10-25T18:00:00Z", ...metrics(500, 100) }, // slid in as a completed bucket
			{ from: "2026-10-25T19:00:00Z", partial: true, ...metrics(100, 20) }, // unchanged
		]);

		const result = ollamaTokensDelta(ollamaTokensDelta(undefined, before).buckets, after);
		expect(result.delta).toBe(600);
		// Re-reading the same response must not count it again.
		expect(ollamaTokensDelta(result.buckets, after).delta).toBe(0);
	});

	it("ignores buckets that slid off the 24h window", () => {
		const before = usageResponse([
			{ from: "2026-10-24T20:00:00Z", ...metrics(900, 100) },
			{ from: "2026-10-25T19:00:00Z", partial: true, ...metrics(10, 5) },
		]);
		const after = usageResponse([{ from: "2026-10-25T19:00:00Z", partial: true, ...metrics(10, 5) }]);

		// The old bucket disappearing must not produce a negative delta.
		const result = ollamaTokensDelta(ollamaTokensDelta(undefined, before).buckets, after);
		expect(result.delta).toBe(0);
		expect(result.buckets).not.toHaveProperty("2026-10-24T20:00:00Z");
	});

	it("clamps a negative bucket revision to zero", () => {
		const before = usageResponse([{ from: "2026-10-25T19:00:00Z", partial: true, ...metrics(200, 50) }]);
		// Completed buckets are immutable per the API contract; any revision is defensive-only.
		const after = usageResponse([{ from: "2026-10-25T19:00:00Z", partial: true, ...metrics(100, 20) }]);

		const result = ollamaTokensDelta(ollamaTokensDelta(undefined, before).buckets, after);
		expect(result.delta).toBe(0);
	});
});