import { afterEach, describe, expect, it, vi } from "vitest";

import { getBalance, getModelContextLength, OllamaApiError } from "../src/actions/ollama-api";

afterEach(() => {
	vi.unstubAllGlobals();
});

const creditPlan = {
	included: { balance_usd: 72.5, allowance_usd: 100, period: { from: "-", until: "2026-11-25T00:00:00Z" } },
	purchased: { balance_usd: 25 },
};

const legacyPlan = {
	included: {
		session: { remaining_percent: 75, resets_at: "2026-10-25T14:00:00Z" },
		weekly: { remaining_percent: 40, resets_at: "2026-10-27T00:00:00Z" },
	},
};

function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(JSON.stringify(body), { status, headers })),
	);
}

describe("getModelContextLength", () => {
	it("reads the context length from /api/show model_info", async () => {
		const mock = vi.fn(async () =>
			new Response(
				JSON.stringify({
					capabilities: ["thinking", "tools"],
					details: { parameter_size: "321B" },
					model_info: {
						"general.architecture": "glm5_next",
						"glm5_next.context_length": 1_048_576,
					},
				}),
				{ status: 200 },
			),
		);
		vi.stubGlobal("fetch", mock);

		expect(await getModelContextLength("glm-5.3-flash")).toBe(1_048_576);
		expect(mock).toHaveBeenCalledWith("https://ollama.com/api/show", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "glm-5.3-flash" }),
		});
	});

	it("returns undefined when the shape holds no context length", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ model_info: {} }), { status: 200 })));

		expect(await getModelContextLength("mystery-model")).toBeUndefined();
	});

	it("falls back to undefined on API errors instead of throwing", async () => {
		// Different model name per test — the registry cache is module-level and correct by design.
		vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

		expect(await getModelContextLength("unlisted-model")).toBeUndefined();
	});
});

describe("getBalance", () => {
	it("hits /api/balance with the bearer token", async () => {
		const mock = vi.fn(async () => new Response(JSON.stringify(creditPlan), { status: 200 }));
		vi.stubGlobal("fetch", mock);

		await getBalance("sekrit");

		expect(mock).toHaveBeenCalledWith("https://ollama.com/api/balance", {
			headers: { Authorization: "Bearer sekrit" },
		});
	});

	it("normalizes the credit-plan response", async () => {
		stubFetch(200, creditPlan);

		expect(await getBalance("k")).toEqual({
			kind: "usd",
			balanceUsd: 72.5,
			allowanceUsd: 100,
			purchasedUsd: 25,
			resetsAt: "2026-11-25T00:00:00Z",
		});
	});

	it("normalizes the legacy subscription response", async () => {
		stubFetch(200, legacyPlan);

		expect(await getBalance("k")).toEqual({
			kind: "percent",
			sessionPercent: 75,
			weeklyPercent: 40,
			resetsAt: "2026-10-27T00:00:00Z",
		});
	});

	it("tolerates missing purchases and reset times", async () => {
		stubFetch(200, { included: { balance_usd: 5, allowance_usd: 10 } });

		expect(await getBalance("k")).toEqual({ kind: "usd", balanceUsd: 5, allowanceUsd: 10, purchasedUsd: 0 });
	});

	it("throws a typed error on 401", async () => {
		stubFetch(401, { error: "invalid credentials" });

		await expect(getBalance("k")).rejects.toBeInstanceOf(OllamaApiError);
		await expect(getBalance("k")).rejects.toMatchObject({ status: 401 });
	});

	it("carries Retry-After on 429", async () => {
		stubFetch(429, { error: "rate limited" }, { "Retry-After": "7" });

		await expect(getBalance("k")).rejects.toMatchObject({ status: 429, retryAfterSeconds: 7 });
	});
});